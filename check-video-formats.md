# Safari Video Format Verification Guide

## How to Check Video Formats in Supabase Storage

Since your videos are stored in Supabase storage (not in the public folder), you need to verify their formats there.

### Option 1: Download and Check Locally

1. Download a sample video from Supabase storage
2. Use a tool to check the codec:
   - **FFmpeg**: `ffmpeg -i "video.mp4"` (shows codec info)
   - **MediaInfo**: GUI tool that shows detailed codec information
   - **VLC**: Right-click video → Tools → Codec Information

### Option 2: Check via Browser Developer Tools

1. Open Safari Developer Tools (Cmd+Option+I)
2. Go to Network tab
3. Load a profile page with a surf level video
4. Find the video request in the network tab
5. Check the response headers for `Content-Type: video/mp4`
6. Inspect the video element in Elements tab to see if it loads

### Option 3: Use FFprobe (Command Line)

If you have FFmpeg installed:
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,codec_type "video.mp4"
```

Expected output for Safari-compatible video:
```
codec_name=h264
codec_type=video
```

## Safari-Compatible Video Encoding Settings

If videos need to be re-encoded, use these FFmpeg settings:

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 \
  -profile:v baseline \
  -level 3.0 \
  -pix_fmt yuv420p \
  -c:a aac \
  -b:a 128k \
  -movflags +faststart \
  output.mp4
```

Key settings:
- `-c:v libx264`: H.264 video codec
- `-profile:v baseline`: Baseline profile (best compatibility)
- `-pix_fmt yuv420p`: Pixel format (required for Safari)
- `-c:a aac`: AAC audio codec
- `-movflags +faststart`: Enables progressive download (important for web)

## Common Safari Video Issues

1. **HEVC/H.265 codec**: Safari on older versions doesn't support this. Use H.264 instead.
2. **VP9/WebM**: Safari doesn't support WebM. Use MP4 with H.264.
3. **High profile H.264**: Use Baseline or Main profile for better compatibility.
4. **Missing faststart flag**: Videos without `faststart` may not play until fully downloaded.

## Testing Checklist

- [ ] Verify all videos are MP4 format
- [ ] Check that video codec is H.264 (not HEVC/H.265)
- [ ] Verify audio codec is AAC (if audio exists)
- [ ] Test video playback in Safari desktop
- [ ] Test video playback in Safari iOS
- [ ] Verify videos have `faststart` flag for progressive download
- [ ] Check video file sizes (very large files may have loading issues)



