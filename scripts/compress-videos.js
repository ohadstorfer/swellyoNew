/**
 * Video Compression Script
 * 
 * Compresses videos in public/surf level/ using ffmpeg best practices:
 * - H.264 codec for maximum compatibility
 * - Optimized bitrate for web delivery
 * - Maintains quality while reducing file size
 * 
 * Requirements:
 * - Install ffmpeg: https://ffmpeg.org/download.html
 * - Add ffmpeg to PATH or update the path below
 * 
 * Usage:
 *   node scripts/compress-videos.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg'; // Update if ffmpeg not in PATH
const INPUT_DIR = path.join(__dirname, '../public/surf level');
const BACKUP_DIR = path.join(__dirname, '../public/surf level/_backup');

// Video compression settings (optimized for web)
const COMPRESSION_SETTINGS = {
  // H.264 codec with optimized settings
  codec: 'libx264',
  // CRF 23 = good quality/size balance (18-28 range, lower = better quality)
  crf: '23',
  // Preset: slower = better compression, faster = faster encoding
  preset: 'medium',
  // Profile for maximum compatibility
  profile: 'high',
  // Level for web compatibility
  level: '4.0',
  // Pixel format
  pix_fmt: 'yuv420p',
  // Audio settings (if audio exists)
  audioCodec: 'aac',
  audioBitrate: '128k',
  // Additional optimizations
  movflags: '+faststart', // Enable fast start for web streaming
  tune: 'film', // Optimize for film-like content
};

/**
 * Check if ffmpeg is available
 */
function checkFFmpeg() {
  try {
    execSync(`${FFMPEG_PATH} -version`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.error('❌ FFmpeg not found!');
    console.error('Please install FFmpeg: https://ffmpeg.org/download.html');
    console.error('Or set FFMPEG_PATH environment variable');
    return false;
  }
}

/**
 * Get video file size in MB
 */
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return (stats.size / (1024 * 1024)).toFixed(2);
}

/**
 * Compress a single video file
 */
function compressVideo(inputPath, outputPath) {
  const inputSize = getFileSize(inputPath);
  
  console.log(`\n📹 Compressing: ${path.basename(inputPath)}`);
  console.log(`   Original size: ${inputSize} MB`);
  
  try {
    // Build ffmpeg command
    const command = [
      FFMPEG_PATH,
      '-i', `"${inputPath}"`,
      '-c:v', COMPRESSION_SETTINGS.codec,
      '-crf', COMPRESSION_SETTINGS.crf,
      '-preset', COMPRESSION_SETTINGS.preset,
      '-profile:v', COMPRESSION_SETTINGS.profile,
      '-level:v', COMPRESSION_SETTINGS.level,
      '-pix_fmt', COMPRESSION_SETTINGS.pix_fmt,
      '-movflags', COMPRESSION_SETTINGS.movflags,
      '-tune', COMPRESSION_SETTINGS.tune,
      '-c:a', COMPRESSION_SETTINGS.audioCodec,
      '-b:a', COMPRESSION_SETTINGS.audioBitrate,
      '-y', // Overwrite output file
      `"${outputPath}"`
    ].join(' ');
    
    // Execute compression
    execSync(command, { stdio: 'inherit' });
    
    const outputSize = getFileSize(outputPath);
    const savings = ((parseFloat(inputSize) - parseFloat(outputSize)) / parseFloat(inputSize) * 100).toFixed(1);
    
    console.log(`   ✅ Compressed size: ${outputSize} MB (${savings}% reduction)`);
    
    return {
      success: true,
      originalSize: inputSize,
      compressedSize: outputSize,
      savings: savings
    };
  } catch (error) {
    console.error(`   ❌ Error compressing: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Process all videos in a directory
 */
function processDirectory(dirPath, relativePath = '') {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativeFilePath = path.join(relativePath, entry.name);
    
    if (entry.isDirectory()) {
      // Skip backup directory
      if (entry.name === '_backup') continue;
      
      // Recursively process subdirectories
      const subResults = processDirectory(fullPath, relativeFilePath);
      results.push(...subResults);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
      // Skip already compressed files (if you add a naming convention)
      if (entry.name.includes('_compressed')) continue;
      
      // Create backup
      const backupPath = path.join(BACKUP_DIR, relativeFilePath);
      const backupDir = path.dirname(backupPath);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      console.log(`\n💾 Backing up: ${relativeFilePath}`);
      fs.copyFileSync(fullPath, backupPath);
      
      // Compress video (overwrite original)
      const result = compressVideo(fullPath, fullPath);
      results.push({
        file: relativeFilePath,
        ...result
      });
    }
  }
  
  return results;
}

/**
 * Main function
 */
function main() {
  console.log('🎬 Video Compression Script');
  console.log('==========================\n');
  
  // Check if input directory exists
  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  
  // Check if ffmpeg is available
  if (!checkFFmpeg()) {
    process.exit(1);
  }
  
  // Create backup directory
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`📁 Created backup directory: ${BACKUP_DIR}`);
  }
  
  // Process all videos
  console.log(`\n🔍 Scanning for videos in: ${INPUT_DIR}`);
  const results = processDirectory(INPUT_DIR);
  
  // Summary
  console.log('\n\n📊 Compression Summary');
  console.log('=====================');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (successful.length > 0) {
    const totalOriginal = successful.reduce((sum, r) => sum + parseFloat(r.originalSize), 0);
    const totalCompressed = successful.reduce((sum, r) => sum + parseFloat(r.compressedSize), 0);
    const totalSavings = ((totalOriginal - totalCompressed) / totalOriginal * 100).toFixed(1);
    
    console.log(`\n✅ Successfully compressed: ${successful.length} videos`);
    console.log(`   Total original size: ${totalOriginal.toFixed(2)} MB`);
    console.log(`   Total compressed size: ${totalCompressed.toFixed(2)} MB`);
    console.log(`   Total space saved: ${(totalOriginal - totalCompressed).toFixed(2)} MB (${totalSavings}%)`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed to compress: ${failed.length} videos`);
    failed.forEach(r => {
      console.log(`   - ${r.file}: ${r.error}`);
    });
  }
  
  console.log(`\n💾 Backups saved to: ${BACKUP_DIR}`);
  console.log('\n✨ Done!');
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { compressVideo, processDirectory };

