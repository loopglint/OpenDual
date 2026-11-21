import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const r = size * 0.24;
  const stroke = Math.max(1.2, size * 0.068);

  // Normalized vector strokes for bilingual emblem: "A" (left-top) + "文" (right-bottom) + subtitle bars
  const segments = [
    // 'A' left-top
    [0.26, 0.56, 0.36, 0.24],
    [0.36, 0.24, 0.46, 0.56],
    [0.295, 0.45, 0.425, 0.45],
    // '文' right-bottom
    [0.64, 0.34, 0.64, 0.42],
    [0.52, 0.44, 0.78, 0.44],
    [0.72, 0.45, 0.55, 0.71],
    [0.57, 0.48, 0.75, 0.71],
    // Bilingual subtitle dual bars at bottom-left
    [0.22, 0.69, 0.44, 0.69],
    [0.22, 0.79, 0.38, 0.79],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      // Signed distance to rounded rect
      const cx = Math.abs(px - size / 2) - (size / 2 - r - size * 0.03);
      const cy = Math.abs(py - size / 2) - (size / 2 - r - size * 0.03);
      const outDist = Math.hypot(Math.max(cx, 0), Math.max(cy, 0)) + Math.min(Math.max(cx, cy), 0) - r;
      const bgAlpha = Math.max(0, Math.min(1, 0.5 - outDist));

      if (bgAlpha <= 0) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Indigo -> Cyan vibrant gradient
      const t = (x / size) * 0.65 + (y / size) * 0.35;
      let rr = 49 + (6 - 49) * t;
      let gg = 72 + (182 - 72) * t;
      let bb = 232 + (212 - 232) * t;

      // Check glyph distance
      const nx = px / size;
      const ny = py / size;
      let minD = 999;
      for (const [x1, y1, x2, y2] of segments) {
        const d = distToSegment(nx, ny, x1, y1, x2, y2) * size;
        if (d < minD) minD = d;
      }
      const fgAlpha = Math.max(0, Math.min(1, (stroke * 0.62 - minD) + 0.5));

      rr = rr * (1 - fgAlpha) + 255 * fgAlpha;
      gg = gg * (1 - fgAlpha) + 255 * fgAlpha;
      bb = bb * (1 - fgAlpha) + 255 * fgAlpha;

      buf[idx] = Math.round(rr);
      buf[idx + 1] = Math.round(gg);
      buf[idx + 2] = Math.round(bb);
      buf[idx + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePNG(size, size, buf);
}

const outDir = path.resolve(process.cwd(), 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), renderIcon(size));
}
console.log('Generated icons in', outDir);
