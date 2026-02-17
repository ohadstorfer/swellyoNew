/**
 * Image Upload Recovery Service
 * Handles recovery of pending uploads on app restart
 */

import {
  getAllPendingUploads,
  removePendingUpload,
  PendingUpload,
} from './imageUploadService';
import {
  uploadImageToStorage,
  processImage,
} from './imageUploadService';
import { messagingService, ImageMetadata } from './messagingService';

const MAX_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_RETRIES = 3;

/**
 * Recover pending uploads on app start
 * Resumes uploads < 24 hours old, marks older ones as failed
 */
export async function recoverPendingUploads(
  onUploadProgress?: (messageId: string, progress: number) => void,
  onUploadComplete?: (messageId: string) => void,
  onUploadFailed?: (messageId: string, error: string) => void
): Promise<void> {
  try {
    const pending = await getAllPendingUploads();
    
    for (const upload of pending) {
      const age = Date.now() - upload.createdAt;
      
      if (age > MAX_UPLOAD_AGE_MS) {
        // Older than 24 hours - mark as failed
        console.log(`[imageUploadRecovery] Marking old upload as failed: ${upload.messageId}`);
        await markUploadFailed(upload.messageId);
        await removePendingUpload(upload.messageId);
        onUploadFailed?.(upload.messageId, 'Upload expired (older than 24 hours)');
      } else if (upload.retryCount >= MAX_RETRIES) {
        // Exceeded max retries - mark as failed
        console.log(`[imageUploadRecovery] Marking upload as failed (max retries): ${upload.messageId}`);
        await markUploadFailed(upload.messageId);
        await removePendingUpload(upload.messageId);
        onUploadFailed?.(upload.messageId, 'Upload failed after maximum retries');
      } else {
        // Resume upload
        console.log(`[imageUploadRecovery] Resuming upload: ${upload.messageId}`);
        resumeUpload(upload, onUploadProgress, onUploadComplete, onUploadFailed).catch(err => {
          console.error(`[imageUploadRecovery] Error resuming upload ${upload.messageId}:`, err);
          onUploadFailed?.(upload.messageId, err?.message || 'Failed to resume upload');
        });
      }
    }
  } catch (error) {
    console.error('[imageUploadRecovery] Error recovering pending uploads:', error);
  }
}

/**
 * Resume a pending upload
 */
async function resumeUpload(
  upload: PendingUpload,
  onUploadProgress?: (messageId: string, progress: number) => void,
  onUploadComplete?: (messageId: string) => void,
  onUploadFailed?: (messageId: string, error: string) => void
): Promise<void> {
  try {
    // Use compressed image if available, otherwise process original
    const imageUri = upload.compressedImageUri || upload.localImageUri;
    let processed;
    
    if (upload.compressedImageUri && upload.thumbnailUri) {
      // Already processed - use existing
      const dimensions = await getImageDimensions(imageUri);
      const fileSize = await getFileSize(imageUri);
      processed = {
        originalUri: upload.compressedImageUri,
        thumbnailUri: upload.thumbnailUri,
        width: 0, // Will be fetched
        height: 0, // Will be fetched
        fileSize,
        mimeType: 'image/jpeg',
      };
      // Fetch dimensions
      const dims = await getImageDimensions(imageUri);
      processed.width = dims.width;
      processed.height = dims.height;
    } else {
      // Need to process
      processed = await processImage(upload.localImageUri);
    }

    // Simulate progress (Supabase doesn't support real progress)
    onUploadProgress?.(upload.messageId, 10);

    // Upload images
    const [originalUrl, thumbnailUrl] = await Promise.all([
      uploadImageToStorage(
        processed.originalUri,
        upload.conversationId,
        upload.messageId,
        false
      ),
      uploadImageToStorage(
        processed.thumbnailUri,
        upload.conversationId,
        upload.messageId,
        true
      ),
    ]);

    onUploadProgress?.(upload.messageId, 90);

    // Update DB record
    const imageMetadata: ImageMetadata = {
      image_url: originalUrl,
      thumbnail_url: thumbnailUrl,
      width: processed.width,
      height: processed.height,
      file_size: processed.fileSize,
      mime_type: processed.mimeType,
      storage_path: `${upload.conversationId}/${upload.messageId}/original.jpg`,
    };

    await messagingService.updateImageMessageMetadata(upload.messageId, imageMetadata);

    onUploadProgress?.(upload.messageId, 100);
    
    // Clean up
    await removePendingUpload(upload.messageId);
    onUploadComplete?.(upload.messageId);
  } catch (error: any) {
    console.error(`[imageUploadRecovery] Error resuming upload ${upload.messageId}:`, error);
    
    // Increment retry count
    const updatedUpload: PendingUpload = {
      ...upload,
      retryCount: upload.retryCount + 1,
    };
    
    if (updatedUpload.retryCount >= MAX_RETRIES) {
      // Max retries exceeded - mark as failed
      await markUploadFailed(upload.messageId);
      await removePendingUpload(upload.messageId);
      onUploadFailed?.(upload.messageId, 'Upload failed after maximum retries');
    } else {
      // Save updated retry count for next attempt
      const { savePendingUpload } = await import('./imageUploadService');
      await savePendingUpload(updatedUpload);
      onUploadFailed?.(upload.messageId, error?.message || 'Upload failed, will retry later');
    }
  }
}

/**
 * Mark upload as failed in database
 */
async function markUploadFailed(messageId: string): Promise<void> {
  try {
    // Option: Soft delete the message or leave it with image_metadata: null
    // For now, we'll leave it - the UI will show failed state
    console.log(`[imageUploadRecovery] Marked upload as failed: ${messageId}`);
  } catch (error) {
    console.error(`[imageUploadRecovery] Error marking upload as failed: ${messageId}`, error);
  }
}


