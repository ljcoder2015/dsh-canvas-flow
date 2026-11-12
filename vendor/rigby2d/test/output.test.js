// SPDX-License-Identifier: MIT OR Apache-2.0
// Output settings (frame rate, size, background, framing): storage, skeleton JSON frame rate, and
// the output frame placement.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { Skeleton, defaultSettings, readSettings } from '../src/core/model.js';
import { animationBounds, outputFrame } from '../src/editor/output.js';

const rigbytron = () => readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/export/rigbytron.skel', import.meta.url)))), 'rigbytron').skeleton;

test('output settings: defaults, validation and the work file', () => {
  assert.deepEqual(new Skeleton().settings, { fps: 30, width: 1920, height: 1080, background: null, frame: null });
  assert.deepEqual(readSettings({ fps: -3, width: 'x', height: 99999, background: [2, 0, 0, 1], frame: { x: 1, y: 2, scale: 0 } }), defaultSettings());
  const sk = new Skeleton();
  sk.settings = { fps: 23.976, width: 2048, height: 858, background: [0, 0, 0, 1], frame: { x: 10, y: 20, scale: 0.5 } };
  assert.deepEqual(Skeleton.fromJson(sk.toJson()).settings, sk.settings);
  // Work files saved before output settings existed open with the defaults.
  const o = sk.toObject();
  delete o.settings;
  assert.deepEqual(Skeleton.fromObject(o).settings, defaultSettings());
});

test('output settings: the frame rate travels in skeleton JSON', () => {
  const sk = rigbytron();
  assert.equal(sk.settings.fps, 30);
  sk.settings.fps = 24;
  const { json } = writeSkeletonJson(sk, { version: '4.3' });
  assert.equal(json.skeleton.fps, 24);
  assert.equal(readSkeletonJson(JSON.parse(JSON.stringify(json))).skeleton.settings.fps, 24);
  sk.settings.fps = 30;
  assert.equal(writeSkeletonJson(sk, { version: '4.3' }).json.skeleton.fps, undefined, '30 is the default and left out');
});

test('output frame: automatic fit and fixed framing', () => {
  const sk = rigbytron();
  const release = sk.animations.findIndex((a) => a.name === 'release');
  const setup = animationBounds(sk, null, 30);
  const whole = animationBounds(sk, release, 30);
  assert.ok(whole[0] < setup[0] - 200, 'the slash reaches beyond the setup pose');
  const s = { ...defaultSettings(), width: 1920, height: 1080 };
  const f = outputFrame(s, whole);
  // Everything fits with a margin, and the frame keeps the output aspect ratio.
  assert.ok(f.x0 < whole[0] && f.x1 > whole[2] && f.y0 < whole[1] && f.y1 > whole[3]);
  assert.ok(Math.abs((f.x1 - f.x0) / (f.y1 - f.y0) - 1920 / 1080) < 1e-9);
  const fixed = outputFrame({ ...s, frame: { x: 100, y: 50, scale: 2 } }, whole);
  assert.deepEqual(fixed, { cx: 100, cy: 50, scale: 2, x0: 100 - 1920, y0: 50 - 1080, x1: 100 + 1920, y1: 50 + 1080 });
});
