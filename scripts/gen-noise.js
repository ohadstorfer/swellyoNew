// Generates a tileable speckle-noise PNG that matches Figma's "noise" fill
// (feTurbulence fractalNoise @ baseFrequency 2 → near per-pixel grain,
// thresholded into black @0.2 and white @0.15 alpha).
//
// Per-pixel random because at baseFrequency 2 the noise varies almost every
// pixel, so a random speckle is visually identical and tiles seamlessly.
//
// Run: node scripts/gen-noise.js
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const BLACK_A = Math.round(0.2 * 255); // 51
const WHITE_A = Math.round(0.15 * 255); // 38

const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (SIZE * y + x) << 2;
    if (Math.random() < 0.5) {
      png.data[idx] = 0;
      png.data[idx + 1] = 0;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = BLACK_A;
    } else {
      png.data[idx] = 255;
      png.data[idx + 1] = 255;
      png.data[idx + 2] = 255;
      png.data[idx + 3] = WHITE_A;
    }
  }
}

const out = path.join(__dirname, '..', 'assets', 'textures', 'noise.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
png.pack().pipe(fs.createWriteStream(out)).on('finish', () => {
  console.log('wrote', out);
});
