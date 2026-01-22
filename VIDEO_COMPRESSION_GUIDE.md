# Video Compression & Serving Guide

This guide explains how to compress and serve videos efficiently in the Swellyo app.

## 🎬 Video Compression

### Prerequisites

1. **Install FFmpeg** (required for compression):
   - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use [chocolatey](https://chocolatey.org/): `choco install ffmpeg`
   - **macOS**: `brew install ffmpeg`
   - **Linux**: `sudo apt-get install ffmpeg` or `sudo yum install ffmpeg`

2. **Verify Installation**:
   ```bash
   ffmpeg -version
   ```

### Compression Settings

The compression script uses these optimized settings:
- **Codec**: H.264 (libx264) - maximum browser compatibility
- **Quality**: CRF 23 - good balance between quality and file size
- **Preset**: Medium - good balance between compression speed and efficiency
- **Profile**: High - ensures compatibility with all devices
- **Fast Start**: Enabled - allows videos to start playing before fully downloaded
- **Audio**: AAC 128kbps - optimized for web

### Running Compression

1. **Compress all videos**:
   ```bash
   npm run compress-videos
   ```

2. **The script will**:
   - Create backups in `public/surf level/_backup/`
   - Compress all `.mp4` files in `public/surf level/`
   - Show compression statistics
   - Overwrite original files with compressed versions

3. **Example output**:
   ```
   📹 Compressing: Charging.mp4
      Original size: 15.23 MB
      ✅ Compressed size: 4.87 MB (68.0% reduction)
   ```

### Manual Compression (Advanced)

If you need custom settings, you can modify `scripts/compress-videos.js` or run ffmpeg directly:

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 \
  -crf 23 \
  -preset medium \
  -profile:v high \
  -level:v 4.0 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -tune film \
  -c:a aac \
  -b:a 128k \
  output.mp4
```

## 📦 Video Serving Best Practices

### Current Implementation

The app uses optimized video serving with:

1. **Lazy Loading**: Videos load only when needed
2. **Metadata Preload**: Only video metadata is preloaded, not the full video
3. **Proper MIME Types**: Correct content types for browser compatibility
4. **Fast Start**: Videos can start playing before fully downloaded

### Video Service Features

The `videoService.ts` provides:

- **Platform-specific URLs**: Automatically handles web vs mobile
- **Optimized attributes**: Preload, lazy loading, proper MIME types
- **Development caching**: Cache-busting in development mode

### Usage in Components

```typescript
import { getVideoUrl, getVideoAttributes } from '../services/media/videoService';

// Get optimized video URL
const videoUrl = getVideoUrl('/surf level/shortboard/Charging.mp4');

// Get optimized attributes for HTML5 video
const attributes = getVideoAttributes();
// Returns: { preload: 'metadata', playsInline: true, muted: true, loop: false }
```

## 🚀 Performance Tips

1. **File Size Targets**:
   - Short videos (< 30s): Aim for < 5MB
   - Medium videos (30-60s): Aim for < 10MB
   - Long videos (> 60s): Aim for < 20MB

2. **Resolution Guidelines**:
   - Mobile: 720p (1280x720) is usually sufficient
   - Desktop: 1080p (1920x1080) for high-quality displays
   - Avoid 4K unless absolutely necessary

3. **Format Recommendations**:
   - **Primary**: MP4 (H.264) - maximum compatibility
   - **Optional**: WebM (VP9) - better compression, but less compatible

4. **Serving Strategy**:
   - Use CDN for production (Netlify, Cloudflare, etc.)
   - Enable HTTP range requests for seeking
   - Use poster images for better UX

## 📝 Git Best Practices

**Important**: Video files should NOT be committed to git due to their large size.

The `.gitignore` file excludes:
- `*.mp4`, `*.mov`, `*.avi`, `*.mkv`, `*.webm`
- All videos in `public/surf level/`

### Recommended Workflow

1. **Local Development**: Keep videos in `public/surf level/`
2. **Version Control**: Only commit code, not videos
3. **Deployment**: 
   - For Netlify: Videos are included in the build output
   - For CDN: Upload videos separately to CDN and reference URLs

### If Videos Are Already in Git

If you've already committed large video files:

```bash
# Remove videos from git (but keep local files)
git rm --cached public/surf level/**/*.mp4

# Commit the removal
git commit -m "Remove video files from git"

# Push (this will remove them from remote)
git push origin main
```

## 🔧 Troubleshooting

### FFmpeg Not Found

If you get "FFmpeg not found":
1. Install FFmpeg (see Prerequisites)
2. Add FFmpeg to your system PATH
3. Or set `FFMPEG_PATH` environment variable:
   ```bash
   export FFMPEG_PATH=/path/to/ffmpeg
   ```

### Compression Takes Too Long

- Use `preset: 'fast'` instead of `'medium'` (less compression, faster)
- Compress videos individually instead of all at once
- Consider using a more powerful machine

### Videos Still Too Large

- Lower CRF value (try 25-28 for smaller files, but lower quality)
- Reduce resolution before compression
- Remove audio if not needed
- Use WebM format for additional compression

### Videos Not Playing

- Check file paths are correct
- Verify MIME types are set correctly
- Ensure videos are in `public/` folder for web
- Check browser console for errors

## 📚 Additional Resources

- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [Web Video Best Practices](https://web.dev/fast/#optimize-your-images-and-video)
- [H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)

