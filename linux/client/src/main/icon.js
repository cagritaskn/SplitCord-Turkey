'use strict';

const { nativeImage } = require('electron');
const zlib = require('node:zlib');
const fs = require('node:fs');

/**
 * Gerçek marka ikonu (client/resources/icon.png, tray-icon.png) eklenene kadar,
 * dışarıdan bir asset dosyasına bağımlı olmadan her zaman geçerli bir ikon üretir.
 * Node'un yerleşik zlib'i dışında hiçbir bağımlılık kullanmaz.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generateSolidPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowLength = size * 3;
  const raw = Buffer.alloc((rowLength + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (rowLength + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

const SPLITCORD_BRAND_COLOR = [88, 101, 242]; // #5865f2

function loadAppIcon(candidatePath, size = 256) {
  if (candidatePath && fs.existsSync(candidatePath)) {
    const img = nativeImage.createFromPath(candidatePath);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createFromBuffer(generateSolidPng(size, SPLITCORD_BRAND_COLOR));
}

module.exports = { loadAppIcon };
