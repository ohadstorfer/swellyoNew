/**
 * Surf Level Video Codec Conversion Script
 * 
 * Downloads surf level videos from Supabase storage, checks their codec,
 * and converts non-H.264 videos to H.264 format for Safari compatibility.
 * 
 * Requirements:
 * - Install ffmpeg and ffprobe: https://ffmpeg.org/download.html
 * - Add ffmpeg/ffprobe to PATH or update paths below
 * - Set EXPO_PUBLIC_SUPABASE_URL in .env file or environment
 * 
 * Usage:
 *   node scripts/convert-surf-videos-to-h264.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

// Load environment variables from .env file if it exists
try {
  if (fs.existsSync(path.join(__dirname, '../.env'))) {
    const envContent = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }
} catch (error) {
  console.warn('⚠️  Could not load .env file:', error.message);
}

// Configuration
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || '';
const SURF_LEVEL_VIDEOS_BUCKET = 'surf-level-videos';
const OUTPUT_DIR = path.join(__dirname, '../public/surf level');
const TEMP_DIR = path.join(__dirname, '../temp-videos');

// Video definitions matching ProfileScreen.tsx
const BOARD_VIDEO_DEFINITIONS = {
  0: [ // Shortboard
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Snapping', videoFileName: 'Snapping.mp4', thumbnailFileName: 'Snapping thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  1: [ // Midlength
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Carving Turns', videoFileName: 'Carving Turns.mp4', thumbnailFileName: 'Carving Turns thumbnail.PNG' },
    { name: 'Charging', videoFileName: 'Charging.mp4', thumbnailFileName: 'Charging thumbnail.PNG' },
  ],
  2: [ // Longboard
    { name: 'Dipping My Toes', videoFileName: 'Dipping My Toes.mp4', thumbnailFileName: 'Dipping My Toes thumbnail.PNG' },
    { name: 'Cruising Around', videoFileName: 'Cruising Around.mp4', thumbnailFileName: 'Cruising Around thumbnail.PNG' },
    { name: 'Cross Stepping', videoFileName: 'CrossStepping.mp4', thumbnailFileName: 'CrossStepping thumbnail.PNG' },
    { name: 'Hanging Toes', videoFileName: 'Hanging Toes.mp4', thumbnailFileName: 'Hanging Toes thumbnail.PNG' },
  ],
};

const BOARD_FOLDER_MAP = {
  0: 'shortboard',
  1: 'midlength',
  2: 'longboard',
};

/**
 * Check if ffmpeg and ffprobe are available
 */
function checkFFmpegTools() {
  const tools = [
    { name: 'ffmpeg', path: FFMPEG_PATH },
    { name: 'ffprobe', path: FFPROBE_PATH },
  ];

  for (const tool of tools) {
    try {
      execSync(`"${tool.path}" -version`, { stdio: 'ignore' });
      console.log(`✅ ${tool.name} found`);
    } catch (error) {
      console.error(`❌ ${tool.name} not found at: ${tool.path}`);
      console.error('Please install FFmpeg: https://ffmpeg.org/download.html');
      console.error('Or set FFPROBE_PATH/FFMPEG_PATH environment variables');
      return false;
    }
  }
  return true;
}

/**
 * Construct Supabase storage URL for a video
 */
function getSupabaseVideoUrl(boardFolder, videoFileName) {
  if (!SUPABASE_URL) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is not set');
  }

  // Clean up SUPABASE_URL (remove trailing slash if present)
  const baseUrl = SUPABASE_URL.replace(/\/$/, '');
  
  // URL encode each path segment separately (like videoService.ts does)
  const pathParts = [boardFolder, videoFileName];
  const encodedParts = pathParts.map(part => encodeURIComponent(part));
  const encodedPath = encodedParts.join('/');
  
  const url = `${baseUrl}/storage/v1/object/public/${SURF_LEVEL_VIDEOS_BUCKET}/${encodedPath}`;
  
  // Validate URL
  try {
    new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL constructed: ${url}. Error: ${error.message}`);
  }
  
  return url;
}

/**
 * Download a file from URL
 */
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    // Validate URL first
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(new Error(`Invalid URL: ${url}. Error: ${error.message}`));
      return;
    }
    
    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        file.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        return downloadFile(response.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}. URL: ${url}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });
    
    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(new Error(`Network error downloading ${url}: ${err.message}`));
    });
    
    file.on('error', (err) => {
      request.destroy();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(new Error(`File write error: ${err.message}`));
    });
  });
}

/**
 * Check video codec using ffprobe
 */
function checkVideoCodec(videoPath) {
  try {
    const command = `"${FFPROBE_PATH}" -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
    const output = execSync(command, { encoding: 'utf8' }).trim();
    return output.toLowerCase();
  } catch (error) {
    console.error(`Error checking codec: ${error.message}`);
    return null;
  }
}

/**
 * Convert video to H.264 with Safari-optimized settings
 */
function convertToH264(inputPath, outputPath) {
  try {
    const command = [
      `"${FFMPEG_PATH}"`,
      '-i', `"${inputPath}"`,
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');
    
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`Error converting video: ${error.message}`);
    return false;
  }
}

/**
 * Process a single video
 */
async function processVideo(boardType, boardFolder, video) {
  const { videoFileName } = video;
  const videoUrl = getSupabaseVideoUrl(boardFolder, videoFileName);
  const tempPath = path.join(TEMP_DIR, `${boardFolder}_${videoFileName}`);
  const outputDir = path.join(OUTPUT_DIR, boardFolder);
  const outputPath = path.join(outputDir, videoFileName);

  console.log(`\n📹 Processing: ${boardFolder}/${videoFileName}`);
  
  try {
    // Validate URL before attempting download
    try {
      new URL(videoUrl);
    } catch (urlError) {
      throw new Error(`Invalid URL: ${videoUrl}. Error: ${urlError.message}`);
    }
    
    console.log(`   URL: ${videoUrl}`);
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`   📁 Created directory: ${outputDir}`);
    }

    // Create temp directory if it doesn't exist
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Download video
    console.log(`   ⬇️  Downloading...`);
    await downloadFile(videoUrl, tempPath);
    const fileSize = (fs.statSync(tempPath).size / (1024 * 1024)).toFixed(2);
    console.log(`   ✅ Downloaded (${fileSize} MB)`);

    // Check codec
    console.log(`   🔍 Checking codec...`);
    const codec = checkVideoCodec(tempPath);
    
    if (!codec) {
      throw new Error('Could not determine video codec');
    }

    console.log(`   📊 Codec: ${codec}`);

    if (codec === 'h264' || codec === 'avc1') {
      // Already H.264, just copy to output
      console.log(`   ✅ Already H.264, copying to output...`);
      fs.copyFileSync(tempPath, outputPath);
      console.log(`   ✅ Saved to: ${outputPath}`);
      return { success: true, converted: false, codec };
    } else {
      // Need to convert
      console.log(`   🔄 Converting to H.264...`);
      const converted = convertToH264(tempPath, outputPath);
      
      if (converted) {
        const outputSize = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        console.log(`   ✅ Converted and saved (${outputSize} MB)`);
        return { success: true, converted: true, codec };
      } else {
        throw new Error('Conversion failed');
      }
    }
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message, codec: null };
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🎬 Surf Level Video Codec Conversion Script');
  console.log('==========================================\n');

  // Validate configuration
  if (!SUPABASE_URL) {
    console.error('❌ EXPO_PUBLIC_SUPABASE_URL is not set!');
    console.error('Please set it in your .env file or environment variables.');
    process.exit(1);
  }

  // Validate URL format
  try {
    const testUrl = new URL(SUPABASE_URL);
    if (!testUrl.protocol || !testUrl.hostname) {
      throw new Error('Invalid URL format');
    }
  } catch (error) {
    console.error(`❌ Invalid EXPO_PUBLIC_SUPABASE_URL format: ${SUPABASE_URL}`);
    console.error('Expected format: https://your-project.supabase.co');
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.log(`📡 Supabase URL: ${SUPABASE_URL}`);
  
  // Test URL construction with a sample video
  try {
    const testUrl = getSupabaseVideoUrl('longboard', 'Hanging Toes.mp4');
    console.log(`📋 Sample URL: ${testUrl}\n`);
  } catch (error) {
    console.error(`❌ Error constructing sample URL: ${error.message}`);
    process.exit(1);
  }

  // Check if ffmpeg tools are available
  if (!checkFFmpegTools()) {
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`📁 Created output directory: ${OUTPUT_DIR}\n`);
  }

  // Process all videos
  const results = [];
  let processed = 0;
  let total = 0;

  // Count total videos
  for (const boardType in BOARD_VIDEO_DEFINITIONS) {
    total += BOARD_VIDEO_DEFINITIONS[boardType].length;
  }

  console.log(`\n🔍 Processing ${total} videos...\n`);

  for (const boardType in BOARD_VIDEO_DEFINITIONS) {
    const boardFolder = BOARD_FOLDER_MAP[boardType];
    const videos = BOARD_VIDEO_DEFINITIONS[boardType];

    for (const video of videos) {
      processed++;
      console.log(`\n[${processed}/${total}]`);
      
      const result = await processVideo(parseInt(boardType), boardFolder, video);
      results.push({
        boardType: boardFolder,
        video: video.videoFileName,
        ...result
      });
    }
  }

  // Summary
  console.log('\n\n📊 Conversion Summary');
  console.log('=====================\n');

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const converted = results.filter(r => r.success && r.converted);
  const alreadyH264 = results.filter(r => r.success && !r.converted);

  if (successful.length > 0) {
    console.log(`✅ Successfully processed: ${successful.length} videos`);
    if (converted.length > 0) {
      console.log(`   🔄 Converted to H.264: ${converted.length} videos`);
      converted.forEach(r => {
        console.log(`      - ${r.boardType}/${r.video} (was ${r.codec})`);
      });
    }
    if (alreadyH264.length > 0) {
      console.log(`   ✅ Already H.264: ${alreadyH264.length} videos`);
    }
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed to process: ${failed.length} videos`);
    failed.forEach(r => {
      console.log(`   - ${r.boardType}/${r.video}: ${r.error || 'Unknown error'}`);
    });
  }

  // Clean up temp directory
  if (fs.existsSync(TEMP_DIR)) {
    try {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      console.log(`\n🧹 Cleaned up temporary files`);
    } catch (error) {
      console.warn(`⚠️  Could not clean up temp directory: ${error.message}`);
    }
  }

  console.log(`\n📁 Videos saved to: ${OUTPUT_DIR}`);
  console.log('\n✨ Done!');
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { processVideo, checkVideoCodec, convertToH264 };

