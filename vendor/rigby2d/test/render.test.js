// SPDX-License-Identifier: MIT OR Apache-2.0
// Offline rendering containers: MP4 and WebM structure, timing and frame ranges. (Encoding and
// drawing run in the browser; these tests check the files built from encoded frames.)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { timing, writeMp4 } from '../src/editor/render/mp4.js';
import { cameraFor, frameRange } from '../src/editor/render/offline.js';
import { writeWebm } from '../src/editor/render/webm.js';

const frames = (n, size = 10) => Array.from({ length: n }, (_, i) => ({ data: new Uint8Array(size).fill(i + 1), key: i % 4 === 0, time: (i * 1000) / 24 }));

/** MP4 boxes as { type, start, size, children } for the container boxes. */
function boxes(b, start = 0, end = b.length) {
  const out = [];
  const v = new DataView(b.buffer, b.byteOffset);
  for (let o = start; o < end; ) {
    const size = v.getUint32(o);
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    const box = { type, start: o, size };
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) box.children = boxes(b, o + 8, o + size);
    out.push(box);
    assert.ok(size >= 8, `box ${type} size`);
    o += size;
  }
  return out;
}
const find = (list, path) => path.split('/').reduce((l, t) => (Array.isArray(l) ? l : l.children).find((x) => x.type === t), list);

test('mp4: box layout, exact NTSC timing and sample table', () => {
  assert.deepEqual(timing(23.976), { timescale: 24000, delta: 1001 });
  assert.deepEqual(timing(29.97), { timescale: 30000, delta: 1001 });
  assert.equal(timing(24).timescale / timing(24).delta, 24);
  const list = frames(10);
  const avcC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe0, 0]);
  const mp4 = writeMp4({ width: 640, height: 360, fps: 24, avcC, frames: list });
  const top = boxes(mp4);
  assert.deepEqual(top.map((x) => x.type), ['ftyp', 'moov', 'mdat'], 'movie header before the data');
  assert.equal(top.at(-1).start + top.at(-1).size, mp4.length);
  const v = new DataView(mp4.buffer);
  const stco = find(top, 'moov/trak/mdia/minf/stbl/stco');
  const offset = v.getUint32(stco.start + 16);
  const mdat = find(top, 'mdat');
  assert.equal(offset, mdat.start + 8, 'samples start right after the mdat header');
  assert.deepEqual([...mp4.subarray(offset, offset + 3)], [1, 1, 1]);
  const stss = find(top, 'moov/trak/mdia/minf/stbl/stss');
  assert.equal(v.getUint32(stss.start + 12), 3, 'key frames 1, 5 and 9');
  const mdhd = find(top, 'moov/trak/mdia/mdhd');
  assert.ok(Math.abs(v.getUint32(mdhd.start + 24) / v.getUint32(mdhd.start + 20) - 10 / 24) < 1e-12, 'duration: 10 frames at 24 fps');
  const tkhd = find(top, 'moov/trak/tkhd');
  assert.equal(v.getUint32(tkhd.start + 84) / 65536, 640);
  assert.equal(v.getUint32(tkhd.start + 88) / 65536, 360);
});

/** Reads EBML element ids and sizes: [{ id, size, start (data), end }]. */
function ebml(b, start = 0, end = b.length) {
  const out = [];
  let o = start;
  const vint = (keepMarker) => {
    const first = b[o];
    let len = 1;
    while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
    let v = keepMarker ? first : first & (0xff >> len);
    for (let i = 1; i < len; i++) v = v * 256 + b[o + i];
    o += len;
    return v;
  };
  while (o < end) {
    const id = vint(true);
    const size = vint(false);
    out.push({ id, size, start: o, end: o + size });
    o += size;
  }
  return out;
}

test('webm: header, track with alpha, clusters and block additions', () => {
  const list = frames(60).map((f, i) => ({ ...f, key: i % 48 === 0, alpha: Uint8Array.from([9, 9]) }));
  const webm = writeWebm({ width: 640, height: 360, fps: 24, codec: 'V_VP9', alpha: true, frames: list });
  const [header, segment] = ebml(webm);
  assert.equal(header.id, 0x1a45dfa3);
  assert.equal(segment.id, 0x18538067);
  assert.equal(segment.end, webm.length);
  const parts = ebml(webm, segment.start, segment.end);
  assert.deepEqual(parts.slice(0, 2).map((p) => p.id), [0x1549a966, 0x1654ae6b], 'info and tracks first');
  const clusters = parts.filter((p) => p.id === 0x1f43b675);
  assert.ok(clusters.length >= 1);
  let blocks = 0;
  let additions = 0;
  for (const c of clusters) {
    for (const e of ebml(webm, c.start, c.end)) {
      if (e.id === 0xa0) {
        blocks++;
        if (ebml(webm, e.start, e.end).some((x) => x.id === 0x75a1)) additions++;
      }
    }
  }
  assert.equal(blocks, 60);
  assert.equal(additions, 60, 'every frame carries its alpha');
  const track = ebml(webm, parts[1].start, parts[1].end)[0];
  const video = ebml(webm, track.start, track.end).find((e) => e.id === 0xe0);
  assert.ok(ebml(webm, video.start, video.end).some((e) => e.id === 0x53c0), 'alpha mode set');
});

test('frame ranges', () => {
  const sk = readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/export/rigbytron.skel', import.meta.url)))), 'r').skeleton;
  const release = sk.animations.findIndex((a) => a.name === 'release');
  assert.deepEqual(frameRange(sk, release, 24), { start: 0, end: 38, count: 39, last: 38 });
  assert.deepEqual(frameRange(sk, release, 24, 10, 500), { start: 10, end: 38, count: 29, last: 38 });
  assert.deepEqual(frameRange(sk, release, 30, 20, 5), { start: 20, end: 20, count: 1, last: 48 });
});

test('video renders carry an Opus audio track', () => {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'));
  const audio = { rate: 48000, channels: 2, preSkip: 312, head, frames: [0, 20, 40].map((time) => ({ data: new Uint8Array([1, 2, 3]), time, samples: 960 })) };
  const frames = [{ data: new Uint8Array([9, 9]), key: true, time: 0 }];
  const text = (b) => new TextDecoder('latin1').decode(b);
  const mp4 = text(writeMp4({ width: 16, height: 16, fps: 30, avcC: new Uint8Array(4), frames, audio }));
  assert.ok(mp4.includes('soun') && mp4.includes('dOps'));
  assert.equal(mp4.split('trak').length - 1, 2);
  const webm = text(writeWebm({ width: 16, height: 16, fps: 30, codec: 'V_VP9', alpha: false, frames, audio }));
  assert.ok(webm.includes('A_OPUS') && webm.includes('OpusHead'));
});

test('the camera bone frames the shot when the framing follows it', () => {
  const doc = { bones: [{ name: 'root' }, { name: 'camera' }] };
  const pose = { world: [{}, { a: 2, b: 0, tx: 50, ty: -20 }] };
  const base = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(cameraFor({ frame: { x: 0, y: 0, scale: 1, camera: true } }, doc, pose, base), { x: 50, y: -20, zoom: 2 });
  assert.equal(cameraFor({ frame: { x: 0, y: 0, scale: 1 } }, doc, pose, base), base);
});

test('MP4 renders carry AAC audio in an mp4a/esds sample entry', () => {
  const audio = { codec: 'aac', rate: 48000, channels: 2, preSkip: 0, config: Uint8Array.of(0x11, 0x90), frames: [0, 21.333, 42.667].map((time) => ({ data: new Uint8Array([1, 2, 3]), time, samples: 1024 })) };
  const frames = [{ data: new Uint8Array([9, 9]), key: true, time: 0 }];
  const bytes = writeMp4({ width: 16, height: 16, fps: 30, avcC: new Uint8Array(4), frames, audio });
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.includes('mp4a') && text.includes('esds') && !text.includes('dOps'));
  // The AudioSpecificConfig sits in the decoder-specific descriptor (tag 5, length 2).
  const at = text.indexOf('\x05\x02\x11\x90');
  assert.ok(at > text.indexOf('esds'));
  // Sample table: 3 samples of 1024 at 48 kHz.
  assert.ok(text.includes('\x00\x00\x00\x03\x00\x00\x04\x00'));
});
