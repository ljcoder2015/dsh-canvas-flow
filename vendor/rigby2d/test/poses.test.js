// SPDX-License-Identifier: MIT OR Apache-2.0
// Pose library and facial controllers: capture, apply at an amount, blends between poses, and
// storage in the work file.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { Pose } from '../src/core/pose.js';
import { applyAmount, blendPoses, capturePose, readControllers, readPoses } from '../src/core/poses.js';

const load = () => readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/export/rigbytron.skel', import.meta.url)))), 'r').skeleton;

test('poses: capture by name and apply at an amount', () => {
  const sk = load();
  const head = sk.bones.findIndex((b) => b.name === 'head');
  const hand = sk.slots.findIndex((s) => s.name === 'hand');
  const pose = new Pose(sk);
  pose.local[head] = { ...pose.local[head], rotation: pose.local[head].rotation + 30 };
  pose.attachment[hand] = 'hand_e';
  const saved = capturePose(sk, pose, 'look', [head], [hand]);
  assert.deepEqual(Object.keys(saved.bones), ['head']);
  assert.deepEqual(saved.slots, { hand: 'hand_e' });

  const fresh = new Pose(sk);
  const half = applyAmount(sk, fresh, saved, 0.5);
  assert.ok(Math.abs(half.bones.get(head).rotation - (sk.bones[head].setup.rotation + 15)) < 1e-9);
  assert.equal(half.slots.get(hand), 'hand_e', 'images switch from the halfway point');
  assert.equal(applyAmount(sk, fresh, saved, 0.4).slots.size, 0);
});

test('poses: blends take the short way around and can start from a snapshot', () => {
  const sk = load();
  const head = sk.bones.findIndex((b) => b.name === 'head');
  const current = new Pose(sk);
  const setupRotation = sk.bones[head].setup.rotation;
  const to = { name: 'turned', bones: { head: { ...sk.bones[head].setup, rotation: setupRotation + 350 } }, slots: {} };
  // 350° ahead is 10° behind: halfway is -5°.
  assert.ok(Math.abs(blendPoses(sk, current, null, to, 0.5).bones.get(head).rotation - (setupRotation - 5)) < 1e-9);
  // While a drag edits the setup pose, blending from its starting snapshot returns to the start at 0.
  const snapshot = { bones: new Map([[head, { ...sk.bones[head].setup }]]), slots: new Map() };
  sk.bones[head].setup = { ...sk.bones[head].setup, rotation: setupRotation + 7 };
  assert.ok(Math.abs(blendPoses(sk, current, null, to, 0, snapshot).bones.get(head).rotation - setupRotation) < 1e-9);
});

test('poses: validation and the work file', () => {
  assert.deepEqual(readPoses([{ name: 'a', bones: { b: { rotation: 'x', scale_x: 2 } }, slots: { s: 5 } }, { bones: {} }]), [
    { name: 'a', bones: { b: { x: 0, y: 0, rotation: 0, scale_x: 2, scale_y: 1, shear_x: 0, shear_y: 0 } }, slots: { s: null } },
  ]);
  assert.deepEqual(readControllers([{ name: 'smile', to: 'happy', value: 4 }, { name: 'bad' }]), [{ name: 'smile', from: null, to: 'happy', value: 1 }]);
  const sk = new Skeleton();
  sk.poses = [{ name: 'p', bones: { root: { x: 1, y: 2, rotation: 3, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 } }, slots: {} }];
  sk.controllers = [{ name: 'c', from: null, to: 'p', value: 0.25 }];
  const back = Skeleton.fromJson(sk.toJson());
  assert.deepEqual(back.poses, sk.poses);
  assert.deepEqual(back.controllers, sk.controllers);
});
