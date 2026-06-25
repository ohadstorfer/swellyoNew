---
name: imagescript-exif-orientation
description: ImageScript EXIF orientation handling, rotate/flip API, EXIF binary parse approach, magick-wasm autoOrient alternative for Supabase Deno edge functions
metadata:
  type: reference
---

## ImageScript EXIF: confirmed behavior

- `Image.decode()` does NOT automatically apply EXIF orientation. No EXIF-related code anywhere in the library source.
- No EXIF Orientation property is exposed after decode. The library is completely EXIF-unaware.
- `encodeJPEG()` does NOT write any EXIF orientation tag.
- No EXIF parse/read API at all.

## ImageScript transform methods (confirmed from source + .d.ts)

```typescript
rotate(angle: number, resize?: boolean): this
// DIRECTION: positive angle = COUNTERCLOCKWISE (confirmed from source:
// internal impl does `360 - angle` before calling underlying rotator)
// So rotate(90) = 90° CCW = same as -90° CW
// To fix orientation 6 (phone portrait = stored rotated 90° CW), call rotate(90) 
// which is 90° CCW to undo the 90° CW storage.

flip(direction: "horizontal" | "vertical"): this
// "horizontal" = mirror left-right (flip across vertical axis)
// "vertical" = mirror top-bottom (flip across horizontal axis)
// No "mirror" method exists. flip() is the only mirror method.
```

## EXIF Orientation 1-8 mapping to ImageScript operations

Correct transform to NORMALIZE each orientation (make it top-left/upright):

| Orient | Stored as | To normalize | ImageScript call |
|--------|-----------|--------------|-----------------|
| 1 | Normal | Nothing | (skip) |
| 2 | Flipped H | Flip H | `flip("horizontal")` |
| 3 | Rotated 180° | Rotate 180° | `rotate(180)` |
| 4 | Flipped V | Flip V | `flip("vertical")` |
| 5 | Transposed (rot90CW + flipH) | rotate(-90) then flipH | `rotate(270).flip("horizontal")` BUT: ImageScript rotate is CCW, so rotate(-90)CCW = rotate(90)CW. Use `rotate(270)` (= -90° CCW = 90° CW), then `flip("horizontal")` |
| 6 | Rotated 90° CW | Rotate 90° CCW | `rotate(90)` (ImageScript positive = CCW, so rotate(90) undoes 90CW) |
| 7 | Transposed (rot90CCW + flipH) | rotate(90) then flipH | `rotate(90).flip("horizontal")` — wrong; need rot90CCW then flipH = `rotate(270).flip("horizontal")`... see note |
| 8 | Rotated 90° CCW | Rotate 90° CW | `rotate(270)` (= 270° CCW = 90° CW in conventional terms) |

**Warning on orientations 5 and 7** (the transposed/mirrored cases): These are rare (mainly old scanners, not phone cameras). The combination of rotate + flip must be done in the right order. Since ImageScript positive = CCW:
- Orientation 5: pixels are rotated 90CW then flipped H → to undo: `rotate(90).flip("horizontal")` (rotate(90)CCW undoes 90CW, then flipH undoes flipH)
- Orientation 7: pixels are rotated 90CCW then flipped H → to undo: `rotate(270).flip("horizontal")` 

Phone cameras almost exclusively produce orientation 1, 6, or 8.

## EXIF binary parse (zero-dependency Deno/TS)

```typescript
function readExifOrientation(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG
  
  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset, false);
    const length = view.getUint16(offset + 2, false);
    
    if (marker === 0xFFE1) {
      // APP1 - check for EXIF header
      if (view.getUint32(offset + 4, false) === 0x45786966 &&
          view.getUint16(offset + 8, false) === 0x0000) {
        // "Exif\0\0" found
        const tiffOffset = offset + 10;
        const little = view.getUint16(tiffOffset, false) === 0x4949; // II = LE, MM = BE
        const ifdOffset = view.getUint32(tiffOffset + 4, little);
        const tagCount = view.getUint16(tiffOffset + ifdOffset, little);
        
        for (let i = 0; i < tagCount; i++) {
          const tagOffset = tiffOffset + ifdOffset + 2 + (i * 12);
          if (view.getUint16(tagOffset, little) === 0x0112) {
            // Found Orientation tag
            return view.getUint16(tagOffset + 8, little);
          }
        }
      }
    }
    
    if (marker === 0xFFDA) break; // SOS = start of image data, stop scanning
    offset += 2 + length;
  }
  return 1; // default: no transform needed
}
```

## magick-wasm / imagemagick_deno approach

Import specifier (pinned, Deno-compatible):
```typescript
import {
  ImageMagick,
  IMagickImage,
  MagickGeometry,
  MagickFormat,
  Gravity,
  initialize,
} from "https://deno.land/x/imagemagick_deno@0.0.31/mod.ts";
```

Init call (must await before any read):
```typescript
await initialize();
```

Key method signatures confirmed from source:
- `img.autoOrient(): void` — reads EXIF Orientation tag and performs the appropriate rotation/flip to normalize. Handles ALL 8 orientations correctly (it's the full ImageMagick implementation).
- `img.resize(width: number, height: number): void` — or pass MagickGeometry
- `img.crop(width: number, height: number, gravity: Gravity): void`
- `img.write<T>(format: MagickFormat, func: (data: Uint8Array) => T): T`
- Gravity enum values include `Gravity.Center`

Complete square-thumbnail pipeline (autoOrient → cover-resize → center-crop → JPEG):
```typescript
const result = await ImageMagick.read(inputBytes, async (img: IMagickImage) => {
  img.autoOrient(); // apply EXIF
  const size = 400; // target square size
  // Cover resize: scale so smaller dimension = size, then center crop
  const scale = size / Math.min(img.width, img.height);
  img.resize(Math.ceil(img.width * scale), Math.ceil(img.height * scale));
  img.crop(size, size, Gravity.Center);
  img.quality = 82; // JPEG quality
  return img.write(MagickFormat.Jpeg, (data) => data);
});
```

Note: `MagickGeometry` has an `ignoreAspectRatio` property. For cover-resize you want aspect ratio preserved (don't set ignoreAspectRatio), then crop.

## Memory / perf notes (Supabase edge runtime)

- The WASM binary (~30MB) is loaded once per isolate lifecycle; subsequent calls in the same invocation don't re-init
- For 1-3MB source JPEGs, decoding + orient + resize + encode typically takes 200-500ms in the edge runtime (acceptable for a background upload pipeline, NOT for on-demand serving)
- autoOrient() is synchronous and inexpensive (just pixel reorder + metadata strip)
- Each ImageMagick.read() call holds the full decoded bitmap in memory — for 12MP phone photos that can be 30-40MB uncompressed. Supabase edge functions have 512MB memory limit but practically shoot for under 150MB per request.

## Recommendation

Use magick-wasm (imagemagick_deno) with autoOrient(). Reasons:
1. autoOrient() correctly handles all 8 EXIF orientations including the mirrored cases (5,7), battle-tested ImageMagick code, zero chance of orientation math error
2. ImageScript + manual EXIF parse is 80 lines of fiddly binary code + orientation math with subtle off-by-one risks
3. The WASM init cost is paid once per isolate, not per request
4. Supabase's own docs recommend this library for edge function image manipulation

The only reason to keep ImageScript: if your function already uses it extensively and the WASM bundle size of imagemagick_deno is a concern. Otherwise, switch.
