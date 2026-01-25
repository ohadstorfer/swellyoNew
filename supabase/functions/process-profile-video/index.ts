import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Cloudinary configuration
const CLOUDINARY_CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME')
const CLOUDINARY_API_KEY = Deno.env.get('CLOUDINARY_API_KEY')
const CLOUDINARY_API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET')

interface ProcessVideoRequest {
  videoPath: string; // e.g., "temp/{userId}/profile-surf-video-123.mp4"
  userId: string;
}

interface ProcessVideoResponse {
  success: boolean;
  message?: string;
  error?: string;
  videoUrl?: string;
}

/**
 * Calculate Cloudinary signature
 * Cloudinary uses SHA1 (not HMAC-SHA1) with the secret appended to the string to sign
 * Format: SHA1(string_to_sign + api_secret)
 */
async function calculateCloudinarySignature(stringToSign: string, secret: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    // Append secret to the string to sign (Cloudinary's format)
    const messageWithSecret = stringToSign + secret;
    const messageData = encoder.encode(messageWithSecret);
    
    // Calculate SHA-1 hash (not HMAC)
    const hashBuffer = await crypto.subtle.digest('SHA-1', messageData);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.error('[Cloudinary Signature] Calculation error:', error);
    throw new Error(`Cloudinary signature calculation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload video to Cloudinary for compression
 * Supports both unsigned (with upload preset) and signed uploads
 */
async function uploadToCloudinary(videoBlob: Blob, publicId: string): Promise<{ success: boolean; url?: string; publicId?: string; originalUrl?: string; error?: string }> {
  try {
    if (!CLOUDINARY_CLOUD_NAME) {
      return { success: false, error: 'CLOUDINARY_CLOUD_NAME not configured' };
    }

    console.log(`[Cloudinary] Uploading video to Cloudinary, publicId: ${publicId}`);

    // Video transformation parameters (for profile display - 480p max)
    // Target: 480p (854x480) max - good balance for profile videos
    // 
    // IMPORTANT: Aspect ratio preservation
    // c_limit: Scales video to fit within 854x480 while preserving original aspect ratio
    // - Videos larger than 854x480 will be scaled down proportionally
    // - Videos smaller than 854x480 will remain unchanged
    // - Portrait videos (9:16), square videos (1:1), wide videos (16:9) all maintain their original ratios
    // - No cropping or distortion occurs
    const transformation = 'w_854,h_480,c_limit,q_auto,f_mp4,vc_h264,ac_aac,br_1000k';

    const formData = new FormData();
    formData.append('file', videoBlob);
    formData.append('public_id', publicId);
    formData.append('resource_type', 'video');
    formData.append('folder', 'profile-videos');
    
    // Check if we have an upload preset (unsigned uploads - recommended for server-side)
    const uploadPreset = Deno.env.get('CLOUDINARY_UPLOAD_PRESET');
    
    if (uploadPreset) {
      // Use unsigned upload with preset (simpler and recommended)
      // IMPORTANT: For unsigned uploads, we CANNOT add transformation parameters here
      // They must be configured in the upload preset OR applied via transformation URL when downloading
      formData.append('upload_preset', uploadPreset);
      console.log('[Cloudinary] Using unsigned upload with preset - transformations will be applied via URL');
    } else if (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
      // Use signed upload (requires HMAC-SHA1 signature)
      // For signed uploads, we can add transformation parameters directly
      formData.append('width', '854');
      formData.append('height', '480');
      formData.append('crop', 'limit');
      formData.append('quality', 'auto');
      formData.append('fetch_format', 'mp4');
      formData.append('video_codec', 'h264');
      formData.append('audio_codec', 'aac');
      formData.append('bit_rate', '1000k');
      
      // Eager transformations: Process video immediately for faster access (only for signed uploads)
      formData.append('eager', transformation);
      
      const timestamp = Math.round(Date.now() / 1000);
      
      // IMPORTANT: Include ALL parameters that will be sent in the signature calculation
      const params: Record<string, string> = {
        folder: 'profile-videos',
        public_id: publicId,
        resource_type: 'video',
        width: '854',
        height: '480',
        crop: 'limit',
        quality: 'auto',
        fetch_format: 'mp4',
        video_codec: 'h264',
        audio_codec: 'aac',
        bit_rate: '1000k',
        eager: transformation,
        timestamp: timestamp.toString(),
      };

      // Build string to sign: sorted params (secret will be appended in signature calculation)
      // Cloudinary uses SHA1 with secret appended: SHA1(params + api_secret)
      const stringToSign = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

      try {
        // Cloudinary uses SHA1 (not HMAC-SHA1) with secret appended
        const signature = await calculateCloudinarySignature(stringToSign, CLOUDINARY_API_SECRET!);
        formData.append('signature', signature);
        formData.append('api_key', CLOUDINARY_API_KEY);
        formData.append('timestamp', timestamp.toString());
        console.log('[Cloudinary] Using signed upload with transformations');
      } catch (sigError) {
        return { 
          success: false, 
          error: `Failed to generate signature: ${sigError instanceof Error ? sigError.message : 'Unknown error'}. Please set CLOUDINARY_UPLOAD_PRESET for unsigned uploads.` 
        };
      }
    } else {
      return { 
        success: false, 
        error: 'Either CLOUDINARY_UPLOAD_PRESET (for unsigned uploads) or CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (for signed uploads) must be configured' 
      };
    }

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Cloudinary] Upload failed:', errorText);
      return { success: false, error: `Cloudinary upload failed: ${errorText}` };
    }

    const result = await response.json();
    console.log(`[Cloudinary] Upload successful, secure_url: ${result.secure_url}, size: ${result.bytes} bytes`);
    
    // CRITICAL: Log the actual public_id that Cloudinary returns
    console.log(`[Cloudinary] Upload response public_id: "${result.public_id}"`);
    console.log(`[Cloudinary] Upload response full:`, JSON.stringify(result, null, 2));
    
    // Build transformation URL for downloading the processed video
    // Apply transformations: 480p max, optimized compression
    // Reuse the transformation string defined at function start
    let processedUrl = result.secure_url;
    
    // Check if eager transformation is available (only for signed uploads)
    if (result.eager && result.eager.length > 0) {
      // Eager transformation is ready - use it directly (faster)
      processedUrl = result.eager[0].secure_url;
      console.log(`[Cloudinary] Using eager transformation URL (already processed): ${processedUrl}`);
    } else {
      // Apply transformation via URL (works for both signed and unsigned uploads)
      // Insert transformation into the URL path
      const urlParts = result.secure_url.split('/upload/');
      if (urlParts.length === 2) {
        processedUrl = `${urlParts[0]}/upload/${transformation}/${urlParts[1]}`;
        console.log(`[Cloudinary] Using transformation URL: ${processedUrl}`);
      } else {
        // Fallback: try to insert transformation
        processedUrl = result.secure_url.replace('/upload/v', `/upload/${transformation}/v`);
        console.log(`[Cloudinary] Using transformation URL (fallback): ${processedUrl}`);
      }
    }
    
    return {
      success: true,
      url: processedUrl,
      publicId: result.public_id,
      originalUrl: result.secure_url,
    };
  } catch (error) {
    console.error('[Cloudinary] Upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Cloudinary error',
    };
  }
}

/**
 * Download compressed video from Cloudinary
 */
async function downloadFromCloudinary(cloudinaryUrl: string): Promise<{ success: boolean; blob?: Blob; error?: string }> {
  try {
    console.log(`[Cloudinary] Downloading compressed video from: ${cloudinaryUrl}`);
    
    const response = await fetch(cloudinaryUrl);
    
    if (!response.ok) {
      return { success: false, error: `Failed to download from Cloudinary: ${response.statusText}` };
    }

    const blob = await response.blob();
    console.log(`[Cloudinary] Downloaded video, size: ${blob.size} bytes`);
    
    return { success: true, blob };
  } catch (error) {
    console.error('[Cloudinary] Download error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown download error',
    };
  }
}

/**
 * Delete video from Cloudinary
 * Requires API key and secret for authentication
 * Note: If HMAC-SHA1 is not supported, deletion will fail gracefully (non-critical)
 */
async function deleteFromCloudinary(publicId: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      console.warn('[Cloudinary] Credentials not configured, skipping deletion');
      return { success: false, error: 'Cloudinary credentials not configured' };
    }

    console.log(`[Cloudinary] Deleting video from Cloudinary, publicId: ${publicId}`);

    const timestamp = Math.round(Date.now() / 1000);
    
    // For Cloudinary destroy API, signature includes only public_id and timestamp
    // resource_type is sent in the request but NOT included in signature calculation
    const params: Record<string, string> = {
      public_id: publicId,
      timestamp: timestamp.toString(),
    };

    // Generate signature for deletion
    // Cloudinary uses SHA1 with secret appended: SHA1(public_id=...&timestamp=... + api_secret)
    const stringToSign = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    console.log(`[Cloudinary] String to sign: ${stringToSign}`);
    console.log(`[Cloudinary] Public ID: ${publicId}, Timestamp: ${timestamp}`);

    let signature: string;
    try {
      // Cloudinary uses SHA1 (not HMAC-SHA1) with secret appended
      signature = await calculateCloudinarySignature(stringToSign, CLOUDINARY_API_SECRET);
      console.log(`[Cloudinary] Generated delete signature (first 20 chars): ${signature.substring(0, 20)}...`);
    } catch (sigError) {
      console.error('[Cloudinary] Failed to generate delete signature:', sigError);
      return { 
        success: false, 
        error: `Signature generation failed: ${sigError instanceof Error ? sigError.message : 'Unknown error'}. Deletion is non-critical - video is already in Supabase.` 
      };
    }

    const deleteUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/destroy`;
    
    const formData = new FormData();
    formData.append('public_id', publicId);
    formData.append('resource_type', 'video');
    formData.append('signature', signature);
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', timestamp.toString());

    const response = await fetch(deleteUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Cloudinary] Delete failed:', errorText);
      
      // Check if it's a signature error - if so, it's likely HMAC-SHA1 not supported
      if (errorText.includes('Invalid Signature')) {
        return { 
          success: false, 
          error: 'Invalid signature - HMAC-SHA1 may not be supported in Deno. Deletion is non-critical.' 
        };
      }
      
      return { success: false, error: `Cloudinary delete failed: ${errorText}` };
    }

    const result = await response.json();
    
    // Log the FULL response to see what Cloudinary actually returns
    console.log(`[Cloudinary] Delete API full response:`, JSON.stringify(result, null, 2));
    console.log(`[Cloudinary] Delete result.result: "${result.result}"`);
    console.log(`[Cloudinary] Delete result.public_id returned: "${result.public_id}"`);
    if (result.deleted) {
      console.log(`[Cloudinary] Delete result.deleted:`, result.deleted);
    }
    
    if (result.result === 'ok') {
      console.log(`[Cloudinary] Video deleted successfully: ${publicId}`);
      return { success: true };
    } else if (result.result === 'not found') {
      // "not found" means the video doesn't exist with this public_id
      // This is a failure since we just uploaded it - the public_id format might be wrong
      console.warn(`[Cloudinary] Video not found with public_id: ${publicId} - may need different format`);
      return { success: false, error: `Video not found with public_id: ${publicId}` };
    } else {
      console.warn(`[Cloudinary] Delete result: ${result.result}`);
      console.warn(`[Cloudinary] Full response:`, JSON.stringify(result, null, 2));
      return { success: false, error: `Delete failed: ${result.result}` };
    }
  } catch (error) {
    console.error('[Cloudinary] Delete error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown delete error',
    };
  }
}

/**
 * Process video with Cloudinary compression
 * 
 * Flow:
 * 1. Download original video from Supabase temp storage
 * 2. Upload to Cloudinary for compression
 * 3. Download compressed video from Cloudinary
 * 4. Upload compressed video to Supabase final location
 * 5. Delete video from Cloudinary (cleanup)
 */
async function processVideoWithCloudinary(
  inputPath: string,
  outputPath: string,
  supabaseClient: any
): Promise<{ success: boolean; error?: string; cloudinaryPublicId?: string }> {
  let cloudinaryPublicId: string | undefined;
  
  try {
    console.log(`[VideoProcessor] Starting Cloudinary video processing: ${inputPath} -> ${outputPath}`);

    // Validate Cloudinary credentials
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return { success: false, error: 'Cloudinary credentials not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Supabase Edge Function secrets.' };
    }

    // Step 1: Download the original video from Supabase Storage
    const { data: videoData, error: downloadError } = await supabaseClient.storage
      .from('profile-surf-videos')
      .download(inputPath);

    if (downloadError || !videoData) {
      return { success: false, error: `Failed to download video: ${downloadError?.message}` };
    }

    console.log(`[VideoProcessor] Video downloaded from Supabase, size: ${videoData.size} bytes`);

    // Step 2: Upload to Cloudinary for compression
    // Generate a unique public_id for Cloudinary
    const fileName = inputPath.split('/').pop() || `video-${Date.now()}`;
    const publicId = `profile-videos/${fileName.replace(/\.[^/.]+$/, '')}`;

    const uploadResult = await uploadToCloudinary(videoData, publicId);
    if (!uploadResult.success || !uploadResult.url) {
      return { success: false, error: uploadResult.error || 'Cloudinary upload failed' };
    }

    // CRITICAL: Use the exact public_id that Cloudinary returns, not the one we sent
    // Cloudinary may modify the public_id (e.g., remove folder prefix, change format)
    cloudinaryPublicId = uploadResult.publicId || publicId;
    console.log(`[VideoProcessor] Video uploaded to Cloudinary, compressed URL: ${uploadResult.url}`);
    console.log(`[VideoProcessor] Cloudinary returned public_id: "${cloudinaryPublicId}" (original sent: "${publicId}")`);

    // Step 3: Download compressed video from Cloudinary
    const downloadResult = await downloadFromCloudinary(uploadResult.url);
    if (!downloadResult.success || !downloadResult.blob) {
      // Try to clean up Cloudinary even if download fails
      if (cloudinaryPublicId) {
        await deleteFromCloudinary(cloudinaryPublicId);
      }
      return { success: false, error: downloadResult.error || 'Failed to download compressed video from Cloudinary' };
    }

    console.log(`[VideoProcessor] Compressed video downloaded, size: ${downloadResult.blob.size} bytes (${((downloadResult.blob.size / videoData.size) * 100).toFixed(1)}% of original)`);

    // Step 4: Upload compressed video to Supabase final location
    const { error: uploadError } = await supabaseClient.storage
      .from('profile-surf-videos')
      .upload(outputPath, downloadResult.blob, {
        contentType: 'video/mp4',
        upsert: true,
      });

    if (uploadError) {
      // Try to clean up Cloudinary even if Supabase upload fails
      if (cloudinaryPublicId) {
        await deleteFromCloudinary(cloudinaryPublicId);
      }
      return { success: false, error: `Failed to upload compressed video to Supabase: ${uploadError.message}` };
    }

    console.log(`[VideoProcessor] Compressed video uploaded to Supabase: ${outputPath}`);

    // Step 5: Delete video from Cloudinary (cleanup) - ALWAYS attempt cleanup
    if (cloudinaryPublicId) {
      let deleteAttempts = 0;
      const maxDeleteAttempts = 3;
      let deleteSuccess = false;
      let publicIdToDelete = cloudinaryPublicId;
      
      while (deleteAttempts < maxDeleteAttempts && !deleteSuccess) {
        deleteAttempts++;
        const deleteResult = await deleteFromCloudinary(publicIdToDelete);
        
        if (deleteResult.success) {
          deleteSuccess = true;
          console.log(`[VideoProcessor] Successfully deleted video from Cloudinary (attempt ${deleteAttempts}): ${publicIdToDelete}`);
        } else {
          // If "not found" and public_id includes a folder, try without folder prefix
          if (deleteResult.error?.includes('not found') && publicIdToDelete.includes('/') && deleteAttempts === 1) {
            const publicIdWithoutFolder = publicIdToDelete.split('/').pop() || publicIdToDelete;
            console.log(`[VideoProcessor] Delete returned "not found", trying without folder prefix: ${publicIdWithoutFolder}`);
            publicIdToDelete = publicIdWithoutFolder;
            // Don't increment attempts, retry immediately with new public_id
            deleteAttempts--;
            continue;
          }
          
          if (deleteAttempts < maxDeleteAttempts) {
            console.warn(`[VideoProcessor] Delete attempt ${deleteAttempts} failed, retrying... Error: ${deleteResult.error}`);
            // Wait 1 second before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // Final attempt failed - log as error but don't fail the request
            console.error(`[VideoProcessor] Failed to delete from Cloudinary after ${maxDeleteAttempts} attempts (non-critical): ${deleteResult.error}`);
            console.error(`[VideoProcessor] Manual cleanup may be needed for public_id: ${cloudinaryPublicId} (tried: ${publicIdToDelete})`);
          }
        }
      }
    } else {
      console.warn('[VideoProcessor] No cloudinaryPublicId available for cleanup');
    }

    console.log(`[VideoProcessor] Video processing completed successfully`);
    
    return { success: true, cloudinaryPublicId };
  } catch (error) {
    console.error('[VideoProcessor] Processing error:', error);
    
    // ALWAYS try to clean up Cloudinary on error (with retries)
    if (cloudinaryPublicId) {
      let deleteAttempts = 0;
      const maxDeleteAttempts = 2; // Fewer retries on error path
      
      while (deleteAttempts < maxDeleteAttempts) {
        deleteAttempts++;
        try {
          const deleteResult = await deleteFromCloudinary(cloudinaryPublicId);
          if (deleteResult.success) {
            console.log(`[VideoProcessor] Cleaned up Cloudinary video on error (attempt ${deleteAttempts}): ${cloudinaryPublicId}`);
            break;
          } else if (deleteAttempts >= maxDeleteAttempts) {
            console.error(`[VideoProcessor] Failed to cleanup Cloudinary after ${maxDeleteAttempts} attempts: ${deleteResult.error}`);
            console.error(`[VideoProcessor] Manual cleanup needed for public_id: ${cloudinaryPublicId}`);
          }
        } catch (cleanupError) {
          console.error(`[VideoProcessor] Cleanup attempt ${deleteAttempts} threw error:`, cleanupError);
          if (deleteAttempts < maxDeleteAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during video processing',
      cloudinaryPublicId,
    };
  }
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Parse request body
    const body: ProcessVideoRequest = await req.json();
    const { videoPath, userId } = body;

    if (!videoPath || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing videoPath or userId' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Verify the video path is in temp directory and belongs to the user
    if (!videoPath.startsWith(`temp/${userId}/`)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid video path' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Generate output path (final location)
    const fileName = videoPath.split('/').pop() || `profile-surf-video-${Date.now()}.mp4`;
    const outputPath = `${userId}/${fileName}`;

    console.log(`[process-profile-video] Processing video: ${videoPath} -> ${outputPath}`);

    // Process video with Cloudinary (compress and optimize)
    const processResult = await processVideoWithCloudinary(videoPath, outputPath, supabaseAdmin);

    if (!processResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: processResult.error || 'Video processing failed',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Get the public URL of the processed video
    const { data: urlData } = supabaseAdmin.storage
      .from('profile-surf-videos')
      .getPublicUrl(outputPath);

    // Update the surfer's profile_video_url in the database
    const { error: updateError } = await supabaseAdmin
      .from('surfers')
      .update({ profile_video_url: urlData.publicUrl })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[process-profile-video] Failed to update database:', updateError);
      // Don't fail the request - video is processed, just DB update failed
      // Could be retried later
    } else {
      console.log(`[process-profile-video] Database updated successfully with video URL: ${urlData.publicUrl}`);
    }

    // Final cleanup safety net: Ensure Cloudinary cleanup happened
    // (Main cleanup happens in processVideoWithCloudinary, this is a backup)
    if (processResult.cloudinaryPublicId) {
      // Only attempt if we have API credentials (for signed uploads)
      // For unsigned uploads, cleanup should have already happened
      if (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
        try {
          const finalCleanup = await deleteFromCloudinary(processResult.cloudinaryPublicId);
          if (finalCleanup.success) {
            console.log(`[process-profile-video] Final cleanup successful: ${processResult.cloudinaryPublicId}`);
          }
        } catch (e) {
          // Ignore - cleanup already attempted in processVideoWithCloudinary
        }
      }
    }

    // Delete the temporary file
    const { error: deleteError } = await supabaseAdmin.storage
      .from('profile-surf-videos')
      .remove([videoPath]);

    if (deleteError) {
      console.warn('[process-profile-video] Failed to delete temp file:', deleteError);
      // Non-critical - temp file can be cleaned up later
    } else {
      console.log(`[process-profile-video] Temp file deleted: ${videoPath}`);
    }

    console.log(`[process-profile-video] Video processed successfully: ${urlData.publicUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Video processed successfully',
        videoUrl: urlData.publicUrl,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[process-profile-video] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
});

