/**
 * Script to convert MP4 video to WebM format for better compression
 * 
 * Requirements:
 * - FFmpeg must be installed and in PATH
 * - Download from: https://ffmpeg.org/download.html
 * - Or use: choco install ffmpeg (Windows with Chocolatey)
 * - Or use: brew install ffmpeg (Mac)
 * 
 * Usage:
 * node convert-video-to-webm.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const inputVideo = path.join(__dirname, 'public', 'swellyo welcome video.mp4');
const outputVideo = path.join(__dirname, 'public', 'swellyo welcome video.webm');
const outputVideoCompressed = path.join(__dirname, 'public', 'swellyo welcome video-compressed.mp4');

console.log('🎬 Video Conversion Script');
console.log('========================\n');

// Check if input file exists
if (!fs.existsSync(inputVideo)) {
  console.error('❌ Input video not found:', inputVideo);
  process.exit(1);
}

// Get file size
const inputStats = fs.statSync(inputVideo);
const inputSizeMB = (inputStats.size / (1024 * 1024)).toFixed(2);
console.log(`📹 Input file: ${path.basename(inputVideo)}`);
console.log(`📊 Size: ${inputSizeMB} MB\n`);

// Check if ffmpeg is available
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  console.log('✅ FFmpeg is installed\n');
} catch (error) {
  console.error('❌ FFmpeg is not installed or not in PATH');
  console.error('\n📥 Install FFmpeg:');
  console.error('   Windows: choco install ffmpeg (or download from https://ffmpeg.org/download.html)');
  console.error('   Mac: brew install ffmpeg');
  console.error('   Linux: sudo apt-get install ffmpeg');
  process.exit(1);
}

// Function to convert to WebM
function convertToWebM() {
  console.log('🔄 Converting to WebM format...');
  console.log('   This may take a few minutes...\n');
  
  try {
    // VP9 codec with good compression
    // -crf 30: Quality (lower = better quality, higher = smaller file, 30 is good balance)
    // -b:v 0: Use CRF mode (constant rate factor)
    // -c:a libopus: Use Opus audio codec (better compression than AAC)
    const command = `ffmpeg -i "${inputVideo}" -c:v libvpx-vp9 -crf 30 -b:v 0 -c:a libopus -y "${outputVideo}"`;
    
    console.log('Running:', command.replace(/\s+/g, ' '));
    console.log('');
    
    execSync(command, { stdio: 'inherit' });
    
    if (fs.existsSync(outputVideo)) {
      const outputStats = fs.statSync(outputVideo);
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      const compressionRatio = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);
      
      console.log('\n✅ WebM conversion complete!');
      console.log(`📊 Output size: ${outputSizeMB} MB`);
      console.log(`📉 Compression: ${compressionRatio}% smaller\n`);
    }
  } catch (error) {
    console.error('\n❌ Error converting to WebM:', error.message);
    process.exit(1);
  }
}

// Function to create compressed MP4 (fallback)
function createCompressedMP4() {
  console.log('🔄 Creating compressed MP4 version...');
  console.log('   This may take a few minutes...\n');
  
  try {
    // H.264 codec with good compression
    // -crf 28: Quality (23 is default, 28 is more compressed)
    // -preset slow: Better compression (slower encoding)
    const command = `ffmpeg -i "${inputVideo}" -vcodec h264 -acodec aac -crf 28 -preset slow -movflags +faststart -y "${outputVideoCompressed}"`;
    
    console.log('Running:', command.replace(/\s+/g, ' '));
    console.log('');
    
    execSync(command, { stdio: 'inherit' });
    
    if (fs.existsSync(outputVideoCompressed)) {
      const outputStats = fs.statSync(outputVideoCompressed);
      const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
      const compressionRatio = ((1 - outputStats.size / inputStats.size) * 100).toFixed(1);
      
      console.log('\n✅ Compressed MP4 created!');
      console.log(`📊 Output size: ${outputSizeMB} MB`);
      console.log(`📉 Compression: ${compressionRatio}% smaller\n`);
    }
  } catch (error) {
    console.error('\n❌ Error creating compressed MP4:', error.message);
  }
}

// Main execution
console.log('Choose conversion option:');
console.log('1. Convert to WebM (best compression, modern browsers)');
console.log('2. Create compressed MP4 (better compatibility)');
console.log('3. Both (recommended)\n');

// For automated execution, do both
console.log('🚀 Starting conversion (both formats)...\n');

convertToWebM();
console.log('\n');
createCompressedMP4();

console.log('\n✨ Done!');
console.log('\n📝 Next steps:');
console.log('   1. Update videoService.ts to use WebM with MP4 fallback');
console.log('   2. Test the video in your browser');
console.log('   3. Consider removing the original if file size is acceptable');

