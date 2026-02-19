/**
 * Simple icon generator for KxAI
 * Generates a 256x256 PNG icon with "Kx" text
 * Then converts to .ico and .icns using electron-icon-builder
 * 
 * Usage: node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Create a minimal 256x256 PNG with a gradient background and "Kx" text
// This is a proper PNG file created programmatically

function createPNG(width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);   // width
  ihdrData.writeUInt32BE(height, 4);  // height
  ihdrData.writeUInt8(8, 8);          // bit depth
  ihdrData.writeUInt8(2, 9);          // color type (RGB)
  ihdrData.writeUInt8(0, 10);         // compression
  ihdrData.writeUInt8(0, 11);         // filter
  ihdrData.writeUInt8(0, 12);         // interlace

  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Create raw pixel data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 3)); // 1 filter byte per row + RGB

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 3);
    rawData[rowOffset] = 0; // No filter

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;

      // Create a nice purple-blue gradient background
      const cx = x / width;
      const cy = y / height;

      let r = Math.floor(40 + 80 * cx);
      let g = Math.floor(20 + 40 * cy);
      let b = Math.floor(140 + 80 * (1 - cx));

      // Draw rounded rectangle background
      const margin = width * 0.08;
      const radius = width * 0.15;
      const inRect = x >= margin && x < width - margin && y >= margin && y < height - margin;

      if (!inRect) {
        // Check rounded corners
        const corners = [
          [margin + radius, margin + radius],
          [width - margin - radius, margin + radius],
          [margin + radius, height - margin - radius],
          [width - margin - radius, height - margin - radius]
        ];

        let inCorner = false;
        for (const [cx2, cy2] of corners) {
          const dx = x - cx2;
          const dy = y - cy2;
          if (dx * dx + dy * dy <= radius * radius) {
            inCorner = true;
            break;
          }
        }

        if (!inCorner) {
          // Outside the rounded rect - transparent-ish (dark)
          r = 30;
          g = 30;
          b = 40;
        }
      }

      // Draw "Kx" text (simple pixel art style)
      const textScale = Math.floor(width / 32);
      const textStartX = Math.floor(width * 0.2);
      const textStartY = Math.floor(height * 0.3);

      // Simple K pattern (8x10 grid, scaled)
      const letterK = [
        [1,0,0,0,0,1,0,0],
        [1,0,0,0,1,0,0,0],
        [1,0,0,1,0,0,0,0],
        [1,0,1,0,0,0,0,0],
        [1,1,0,0,0,0,0,0],
        [1,0,1,0,0,0,0,0],
        [1,0,0,1,0,0,0,0],
        [1,0,0,0,1,0,0,0],
        [1,0,0,0,0,1,0,0],
        [1,0,0,0,0,0,1,0],
      ];

      // Simple x pattern
      const letterX = [
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0],
        [1,0,0,0,0,1,0,0],
        [0,1,0,0,1,0,0,0],
        [0,0,1,1,0,0,0,0],
        [0,0,1,1,0,0,0,0],
        [0,1,0,0,1,0,0,0],
        [1,0,0,0,0,1,0,0],
        [0,0,0,0,0,0,0,0],
      ];

      // Render K
      const kx = Math.floor((x - textStartX) / textScale);
      const ky = Math.floor((y - textStartY) / textScale);
      if (kx >= 0 && kx < 8 && ky >= 0 && ky < 10 && letterK[ky] && letterK[ky][kx]) {
        r = 255; g = 255; b = 255;
      }

      // Render x (offset by 9 columns)
      const xxOff = textStartX + 9 * textScale;
      const xx = Math.floor((x - xxOff) / textScale);
      const xy = Math.floor((y - textStartY) / textScale);
      if (xx >= 0 && xx < 8 && xy >= 0 && xy < 10 && letterX[xy] && letterX[xy][xx]) {
        r = 200; g = 230; b = 255;
      }

      rawData[pixelOffset] = Math.min(255, Math.max(0, r));
      rawData[pixelOffset + 1] = Math.min(255, Math.max(0, g));
      rawData[pixelOffset + 2] = Math.min(255, Math.max(0, b));
    }
  }

  // Compress with zlib
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);

  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate 256x256 PNG
const png256 = createPNG(256, 256);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), png256);
console.log('✓ Created assets/icon.png (256x256)');

// Generate 512x512 PNG for macOS
const png512 = createPNG(512, 512);
fs.writeFileSync(path.join(assetsDir, 'icon-512.png'), png512);
console.log('✓ Created assets/icon-512.png (512x512)');

console.log('\nDone! For .ico and .icns conversion:');
console.log('  npm install --save-dev electron-icon-builder');
console.log('  npx electron-icon-builder --input=assets/icon-512.png --output=assets');
console.log('\nOr use online converters:');
console.log('  PNG → ICO: https://convertico.com');
console.log('  PNG → ICNS: https://cloudconvert.com/png-to-icns');
