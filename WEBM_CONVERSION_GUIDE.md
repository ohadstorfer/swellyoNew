# WebM Video Conversion Guide

This guide will help you convert the welcome video to WebM format for better compression and faster loading.

## Why WebM?

- **Better Compression**: WebM (VP9 codec) typically provides 30-50% better compression than MP4 (H.264)
- **Smaller File Size**: Your 54MB MP4 could become 20-30MB in WebM
- **Faster Loading**: Smaller files = faster downloads
- **Modern Browser Support**: All modern browsers support WebM

## Prerequisites

### Install FFmpeg

**Windows:**
```powershell
# Option 1: Using Chocolatey (recommended)
choco install ffmpeg

# Option 2: Manual installation
# Download from: https://www.gyan.dev/ffmpeg/builds/
# Extract and add to PATH
```

**Mac:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

## Quick Start

### Option 1: Use the Automated Script (Recommended)

1. Make sure FFmpeg is installed and in your PATH
2. Run the conversion script:
   ```bash
   node convert-video-to-webm.js
   ```
3. The script will:
   - Check if FFmpeg is installed
   - Convert to WebM format
   - Create a compressed MP4 version (fallback)
   - Show file size comparison

### Option 2: Manual Conversion

#### Convert to WebM:
```bash
ffmpeg -i "public/swellyo welcome video.mp4" -c:v libvpx-vp9 -crf 30 -b:v 0 -c:a libopus -y "public/swellyo welcome video.webm"
```

#### Create Compressed MP4 (fallback):
```bash
ffmpeg -i "public/swellyo welcome video.mp4" -vcodec h264 -acodec aac -crf 28 -preset slow -movflags +faststart -y "public/swellyo welcome video-compressed.mp4"
```

## Command Parameters Explained

### WebM Conversion:
- `-c:v libvpx-vp9`: Use VP9 video codec (best compression)
- `-crf 30`: Quality setting (lower = better quality, 30 is good balance)
- `-b:v 0`: Use CRF mode (constant rate factor)
- `-c:a libopus`: Use Opus audio codec (better compression)
- `-y`: Overwrite output file if exists

### MP4 Compression:
- `-vcodec h264`: Use H.264 video codec
- `-acodec aac`: Use AAC audio codec
- `-crf 28`: Quality setting (28 = more compressed than default 23)
- `-preset slow`: Better compression (takes longer to encode)
- `-movflags +faststart`: Optimize for web streaming

## Quality Settings

Adjust `-crf` value based on your needs:

- **CRF 23-25**: High quality, larger file (good for important videos)
- **CRF 28-30**: Good balance (recommended for web)
- **CRF 32-35**: Smaller file, lower quality (for very large videos)

## Expected Results

For a 54MB MP4 file:
- **WebM**: ~20-30MB (40-50% smaller)
- **Compressed MP4**: ~25-35MB (30-40% smaller)

## After Conversion

1. **Test the video**: Open `public/swellyo welcome video.webm` in a browser
2. **Check file size**: Compare with original
3. **Update code**: The code is already updated to use WebM with MP4 fallback
4. **Deploy**: Both files will be deployed to Netlify

## Browser Support

- ✅ Chrome/Edge: Full WebM support
- ✅ Firefox: Full WebM support
- ✅ Safari: MP4 fallback (Safari doesn't support WebM)
- ✅ Mobile browsers: MP4 fallback

The code automatically uses WebM when available and falls back to MP4 for Safari/older browsers.

## Troubleshooting

### FFmpeg not found
- Make sure FFmpeg is installed
- Add FFmpeg to your system PATH
- Restart your terminal/command prompt

### Conversion takes too long
- This is normal for high-quality encoding
- Use `-preset fast` instead of `-preset slow` for faster encoding (slightly larger file)

### File size is still large
- Try increasing CRF value (e.g., `-crf 32`)
- Consider reducing video resolution if acceptable
- Check if video has unnecessary audio (you can remove audio for background video)

### Video quality is too low
- Decrease CRF value (e.g., `-crf 25`)
- Use `-preset slow` for better compression at same quality

## Additional Optimization Tips

1. **Remove audio** (if not needed for background video):
   ```bash
   ffmpeg -i "input.mp4" -c:v libvpx-vp9 -crf 30 -an -y "output.webm"
   ```
   (`-an` removes audio)

2. **Reduce resolution** (if acceptable):
   ```bash
   ffmpeg -i "input.mp4" -vf scale=1920:1080 -c:v libvpx-vp9 -crf 30 -y "output.webm"
   ```

3. **Limit video length** (if you only need a loop):
   ```bash
   ffmpeg -i "input.mp4" -t 30 -c:v libvpx-vp9 -crf 30 -y "output.webm"
   ```
   (30 seconds)

