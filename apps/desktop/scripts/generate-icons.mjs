#!/usr/bin/env node
/**
 * Generates crisp QuickCart Windows desktop icons (PNG + multi-size ICO)
 * using only Node.js built-ins (no native canvas/sharp dependency required).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(buildDir, { recursive: true });

// CRC32 table for valid PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isInsideRoundedRect(x, y, left, top, width, height, radius) {
  const right = left + width;
  const bottom = top + height;
  if (x < left || x >= right || y < top || y >= bottom) return false;

  const rx = Math.min(radius, width / 2);
  const ry = Math.min(radius, height / 2);
  const cx =
    x < left + rx ? left + rx : x > right - rx ? right - rx : x;
  const cy =
    y < top + ry ? top + ry : y > bottom - ry ? bottom - ry : y;

  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= rx * rx;
}

function renderIconPng(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const pad = Math.round(size * 0.06);
  const tileSize = size - pad * 2;
  const radius = size * 0.2;

  const barLeft = pad + Math.round(tileSize * 0.2);
  const barWidth = Math.round(tileSize * 0.6);
  const barHeight = Math.max(2, Math.round(tileSize * 0.11));
  const barRadius = barHeight / 2;

  const bar1Top = pad + Math.round(tileSize * 0.25);
  const bar2Top = pad + Math.round(tileSize * 0.445);
  const bar3Top = pad + Math.round(tileSize * 0.64);

  const ink = [0x1f, 0x1b, 0x16, 0xff]; // #1f1b16
  const paper = [0xf7, 0xf4, 0xee, 0xff]; // #f7f4ee
  const accent = [0x04, 0x78, 0x57, 0xff]; // #047857

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = [0, 0, 0, 0];
      if (isInsideRoundedRect(x + 0.5, y + 0.5, pad, pad, tileSize, tileSize, radius)) {
        color = ink;
        if (
          isInsideRoundedRect(x + 0.5, y + 0.5, barLeft, bar1Top, barWidth, barHeight, barRadius)
        ) {
          color = paper;
        } else if (
          isInsideRoundedRect(
            x + 0.5,
            y + 0.5,
            barLeft,
            bar2Top,
            Math.round(barWidth * 0.82),
            barHeight,
            barRadius,
          )
        ) {
          color = accent;
        } else if (
          isInsideRoundedRect(x + 0.5, y + 0.5, barLeft, bar3Top, barWidth, barHeight, barRadius)
        ) {
          color = paper;
        }
      }
      const offset = (y * size + x) * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = color[3];
    }
  }

  return encodePng(size, rgba);
}

function encodeIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size;
    dir[1] = size >= 256 ? 0 : size;
    dir[2] = 0; // palette count
    dir[3] = 0;
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bpp
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    offset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.png)]);
}

const png256 = renderIconPng(256);
const png64 = renderIconPng(64);
const png32 = renderIconPng(32);
const png16 = renderIconPng(16);

fs.writeFileSync(path.join(buildDir, 'icon.png'), png256);
fs.writeFileSync(
  path.join(buildDir, 'icon.ico'),
  encodeIco([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
    { size: 64, png: png64 },
    { size: 256, png: png256 },
  ]),
);

console.log(`Generated QuickCart Windows icons in ${buildDir}`);
