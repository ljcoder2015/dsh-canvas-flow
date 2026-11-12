// SPDX-License-Identifier: MIT OR Apache-2.0
// PNG reading and writing for the MCP server (Node.js has no canvas): 8-bit images, any color
// type, not interlaced, which covers the images Rigby2D and image editors write.

import zlib from 'node:zlib';

import { crc32 } from '../editor/zip.js';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decodes a PNG into { width, height, data (RGBA bytes) }. */
export function decodePng(bytes) {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('not a PNG image');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  for (let o = 8; o + 8 <= bytes.length; ) {
    const len = v.getUint32(o);
    const kind = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      width = v.getUint32(o + 8);
      height = v.getUint32(o + 12);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    o += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (${depth}-bit${interlace ? ', interlaced' : ''}); save it as 8-bit, not interlaced`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`unsupported PNG color type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let p = line[x];
      if (filter === 1) p += a;
      else if (filter === 2) p += b;
      else if (filter === 3) p += (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c;
        const pa = Math.abs(e - a);
        const pb = Math.abs(e - b);
        const pc = Math.abs(e - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = p & 255;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let al = 255;
    if (type === 6) [r, g, b, al] = pixels.subarray(s, s + 4);
    else if (type === 2) [r, g, b] = pixels.subarray(s, s + 3);
    else if (type === 4) [r, al] = [pixels[s], pixels[s + 1]];
    else if (type === 0) r = pixels[s];
    else {
      const k = pixels[s];
      [r, g, b] = palette ? palette.subarray(k * 3, k * 3 + 3) : [k, k, k];
      al = trns && k < trns.length ? trns[k] : 255;
    }
    data.set([r, g ?? r, b ?? r, al], i * 4);
  }
  return { width, height, data };
}

/** Encodes RGBA pixels as a PNG. */
export function encodePng({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (kind, body) => {
    const out = new Uint8Array(12 + body.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, body.length);
    out.set(new TextEncoder().encode(kind), 4);
    out.set(body, 8);
    v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(zlib.deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The alpha channel of RGBA pixels: { width, height, data (one byte per pixel) }. */
export function alphaOf({ width, height, data }) {
  const a = new Uint8Array(width * height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * 4 + 3];
  return { width, height, data: a };
}
