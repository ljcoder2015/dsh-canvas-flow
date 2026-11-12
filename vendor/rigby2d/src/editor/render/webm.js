// SPDX-License-Identifier: MIT OR Apache-2.0
// Minimal WebM (Matroska) writer for one video track of encoded frames (VP8 or VP9) and an optional Opus audio track, with
// optional alpha (VP9 alpha side data stored as block additions, as browsers expect).

const enc = new TextEncoder();

/** EBML variable-size integer for an element size. */
function vint(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) {
        out[i] = v & 0xff;
        v = Math.floor(v / 256);
      }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error('element too large');
}

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Uint8Array.from(out);
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function el(id, ...children) {
  const data = concat(children.map((c) => (c instanceof Uint8Array ? c : c)));
  return concat([idBytes(id), vint(data.length), data]);
}

function uint(id, v) {
  const bytes = [];
  let x = v;
  do {
    bytes.unshift(x & 0xff);
    x = Math.floor(x / 256);
  } while (x > 0);
  return el(id, Uint8Array.from(bytes));
}

function float(id, v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v);
  return el(id, b);
}

const str = (id, s) => el(id, enc.encode(s));

/** Block header: track 1, timecode relative to the cluster, flags. */
function blockHeader(relative, flags, track = 0x81) {
  const b = new Uint8Array(4);
  b[0] = track;
  new DataView(b.buffer).setInt16(1, relative);
  b[3] = flags;
  return b;
}

/**
 * Builds a WebM file. `frames` are { data: Uint8Array, alpha: Uint8Array | null, key: boolean,
 * time: milliseconds }. `codec` is 'V_VP9' or 'V_VP8'.
 */
export function writeWebm({ width, height, fps, codec, alpha, frames, audio = null, app = 'Rigby2D' }) {
  const frameMs = 1000 / fps;
  const duration = frames.length * frameMs;
  const header = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  const info = el(0x1549a966, uint(0x2ad7b1, 1_000_000), float(0x4489, duration), str(0x4d80, app), str(0x5741, app));
  const video = el(0xe0, uint(0xb0, width), uint(0xba, height), ...(alpha ? [uint(0x53c0, 1)] : []));
  const audioTrack = audio
    ? [el(0xae, uint(0xd7, 2), uint(0x73c5, 2), uint(0x83, 2), uint(0x9c, 0), str(0x86, 'A_OPUS'), el(0x63a2, audio.head), uint(0x56aa, Math.round((audio.preSkip / audio.rate) * 1e9)), uint(0x56bb, 80_000_000), el(0xe1, float(0xb5, audio.rate), uint(0x9f, audio.channels)))]
    : [];
  const tracks = el(0x1654ae6b, el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), uint(0x9c, 0), str(0x86, codec), uint(0x23e383, Math.round(1e9 / fps)), video), ...audioTrack);
  // Clusters: a new one at a key frame once the current one is long, and before relative
  // timestamps outgrow 16 bits.
  const clusters = [];
  let start = null;
  let blocks = [];
  const flush = () => {
    if (start !== null) clusters.push(el(0x1f43b675, uint(0xe7, Math.round(start)), ...blocks));
    blocks = [];
  };
  let previous = null;
  // Video and audio blocks interleaved by time.
  const all = [...frames.map((f) => ({ ...f, track: 1 })), ...(audio?.frames ?? []).map((f) => ({ ...f, key: true, track: 2 }))].sort((a, b) => a.time - b.time || a.track - b.track);
  for (const f of all) {
    if (f.track === 2) {
      const t = Math.round(f.time);
      if (start === null || t - start > 30000) {
        flush();
        start = t;
      }
      blocks.push(el(0xa3, blockHeader(t - start, 0x80, 0x82), f.data));
      continue;
    }
    const t = Math.round(f.time);
    if (start === null || (f.key && t - start >= 5000) || t - start > 30000) {
      flush();
      start = t;
    }
    const relative = t - start;
    if (f.alpha && f.alpha.length) {
      const block = el(0xa1, blockHeader(relative, 0), f.data);
      const more = el(0x75a1, el(0xa6, uint(0xee, 1), el(0xa5, f.alpha)));
      const reference = f.key || previous === null ? [] : [el(0xfb, signed(previous - t))];
      blocks.push(el(0xa0, block, more, ...reference));
    } else {
      blocks.push(el(0xa3, blockHeader(relative, f.key ? 0x80 : 0), f.data));
    }
    previous = t;
  }
  flush();
  const segment = el(0x18538067, info, tracks, ...clusters);
  return concat([header, segment]);
}

/** A signed integer element body (two's complement, big-endian, minimal length). */
function signed(v) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v);
  let i = 0;
  while (i < 3 && ((b[i] === 0 && (b[i + 1] & 0x80) === 0) || (b[i] === 0xff && (b[i + 1] & 0x80) !== 0))) i++;
  return b.slice(i);
}
