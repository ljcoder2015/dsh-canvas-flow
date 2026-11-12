// SPDX-License-Identifier: MIT OR Apache-2.0
// A procedurally drawn sample character so new users can explore without any art.

import { Animation, setKey } from '../core/animation.js';
import { EASE_IN_OUT, STEPPED } from '../core/curve.js';
import { transform } from '../core/math.js';
import { Skeleton, makeAttachment, makeBone, makeSlot } from '../core/model.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const u8 = (v) => clamp(Math.trunc(v), 0, 255);

function blank(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function cloneRgba(img) {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Anti-aliased rounded rectangle with an outline. */
function rounded(w, h, radius, fill, outline) {
  const img = blank(w, h);
  const hw = w * 0.5 - 1;
  const hh = h * 0.5 - 1;
  const r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = Math.abs(x + 0.5 - w * 0.5) - (hw - r);
      const py = Math.abs(y + 0.5 - h * 0.5) - (hh - r);
      const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
      const alpha = clamp(0.5 - outside, 0, 1);
      const edge = clamp(outside + 3.5, 0, 1);
      const o = (y * w + x) * 4;
      for (let i = 0; i < 3; i++) img.data[o + i] = u8(fill[i] * (1 - edge) + outline[i] * edge);
      img.data[o + 3] = u8(alpha * 255);
    }
  }
  return img;
}

function disc(img, cx, cy, r, color) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
      const a = clamp(0.5 - d, 0, 1);
      const o = (y * img.width + x) * 4;
      if (a > 0 && img.data[o + 3] > 0) {
        for (let i = 0; i < 3; i++) img.data[o + i] = u8(img.data[o + i] * (1 - a) + color[i] * a);
      }
    }
  }
}

function bar(img, x0, y0, x1, y1, color) {
  for (let y = y0; y < Math.min(y1, img.height); y++) {
    for (let x = x0; x < Math.min(x1, img.width); x++) {
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] > 0) {
        img.data[o] = color[0];
        img.data[o + 1] = color[1];
        img.data[o + 2] = color[2];
      }
    }
  }
}

/**
 * Builds the sample robot with "walk" and "idle" animations. `images` receives the art through
 * `insertRgba(name, { width, height, data })`.
 */
export function robot(images) {
  const BODY = [92, 152, 214];
  const BODY_BACK = [64, 108, 160];
  const LINE = [24, 36, 56];
  const JOINT = [250, 196, 70];

  const art = [];
  const torsoImg = rounded(132, 88, 26, BODY, LINE);
  disc(torsoImg, 70, 44, 15, JOINT);
  disc(torsoImg, 70, 44, 8, [255, 240, 200]);
  art.push(['torso', torsoImg]);
  const headImg = rounded(100, 84, 30, [214, 226, 240], LINE);
  bar(headImg, 18, 26, 84, 50, [40, 52, 72]);
  const blinkImg = cloneRgba(headImg);
  disc(headImg, 38, 38, 7, [120, 240, 255]);
  disc(headImg, 64, 38, 7, [120, 240, 255]);
  bar(blinkImg, 30, 37, 46, 40, [120, 240, 255]);
  bar(blinkImg, 56, 37, 72, 40, [120, 240, 255]);
  art.push(['head', headImg]);
  art.push(['head_blink', blinkImg]);
  for (const [suffix, fill] of [['front', BODY], ['back', BODY_BACK]]) {
    const upper = rounded(78, 26, 13, fill, LINE);
    disc(upper, 13, 13, 6, JOINT);
    art.push([`upper_arm_${suffix}`, upper]);
    const lower = rounded(76, 24, 12, fill, LINE);
    disc(lower, 64, 12, 9, [214, 226, 240]);
    art.push([`lower_arm_${suffix}`, lower]);
    const thigh = rounded(96, 32, 15, fill, LINE);
    disc(thigh, 16, 16, 7, JOINT);
    art.push([`thigh_${suffix}`, thigh]);
    const shin = rounded(96, 30, 14, fill, LINE);
    bar(shin, 80, 2, 94, 28, [40, 52, 72]);
    art.push([`shin_${suffix}`, shin]);
  }

  const sk = new Skeleton();
  sk.name = 'robot';
  for (const [name, img] of art) {
    sk.images.push({ name, path: null, width: img.width, height: img.height });
    images.insertRgba(name, img);
  }
  const size = (name) => {
    const img = art.find(([n]) => n === name)[1];
    return [img.width, img.height];
  };

  const hip = sk.addBone(makeBone('hip', 0, transform(0, 165, 0), 0));
  const torso = sk.addBone(makeBone('torso', hip, transform(0, 0, 92), 110));
  sk.addBone(makeBone('head', torso, transform(112, 0, -2), 70));
  // Bone indices shift as bones are inserted; resolve by name once the tree is final.
  const idx = (n) => sk.boneIndex(n);
  const limb = (name, parent, at, len) => sk.addBone(makeBone(name, idx(parent), at, len));
  limb('upper_arm_back', 'torso', transform(96, 0, 182), 62);
  limb('lower_arm_back', 'upper_arm_back', transform(62, 0, 12), 58);
  limb('thigh_back', 'hip', transform(0, 0, -90), 80);
  limb('shin_back', 'thigh_back', transform(80, 0, 0), 80);
  limb('thigh_front', 'hip', transform(0, 0, -90), 80);
  limb('shin_front', 'thigh_front', transform(80, 0, 0), 80);
  limb('upper_arm_front', 'torso', transform(96, 0, 178), 62);
  limb('lower_arm_front', 'upper_arm_front', transform(62, 0, 12), 58);

  const slot = (bone, image, along, rotation) => {
    const [w, h] = size(image);
    sk.slots.push(makeSlot(image, idx(bone), makeAttachment(image, image, transform(along, 0, rotation), w, h)));
  };
  for (const side of ['back', 'front']) {
    if (side === 'front') {
      slot('torso', 'torso', 52, 0);
      slot('head', 'head', 36, -90);
    }
    slot(`thigh_${side}`, `thigh_${side}`, 40, 0);
    slot(`shin_${side}`, `shin_${side}`, 40, 0);
    slot(`upper_arm_${side}`, `upper_arm_${side}`, 26, 0);
    slot(`lower_arm_${side}`, `lower_arm_${side}`, 26, 0);
  }
  const headSlot = sk.slotIndex('head');
  const [bw, bh] = size('head_blink');
  sk.slots[headSlot].attachments.push(makeAttachment('head_blink', 'head_blink', transform(36, 0, -90), bw, bh));

  const ease = () => ({ bezier: EASE_IN_OUT.bezier.slice() });
  const rot = (a, bone, keys) => {
    const tl = a.boneTimelineMut(idx(bone));
    for (const [t, v] of keys) setKey(tl.rotate, t, v, ease());
  };

  const walk = new Animation('walk', 1);
  rot(walk, 'thigh_front', [[0, 28], [0.5, -24], [1, 28]]);
  rot(walk, 'thigh_back', [[0, -24], [0.5, 28], [1, -24]]);
  rot(walk, 'shin_front', [[0, -6], [0.5, -8], [0.75, -55], [1, -6]]);
  rot(walk, 'shin_back', [[0, -8], [0.25, -55], [0.5, -6], [1, -8]]);
  rot(walk, 'upper_arm_front', [[0, -24], [0.5, 24], [1, -24]]);
  rot(walk, 'upper_arm_back', [[0, 24], [0.5, -24], [1, 24]]);
  rot(walk, 'lower_arm_front', [[0, 4], [0.5, 26], [1, 4]]);
  rot(walk, 'lower_arm_back', [[0, 26], [0.5, 4], [1, 26]]);
  rot(walk, 'torso', [[0, -4], [0.25, -6], [0.5, -4], [0.75, -6], [1, -4]]);
  rot(walk, 'head', [[0, 3], [0.5, -2], [1, 3]]);
  const walkHip = walk.boneTimelineMut(idx('hip'));
  for (const [t, y] of [[0, 0], [0.25, -8], [0.5, 0], [0.75, -8], [1, 0]]) setKey(walkHip.translate, t, [0, y], ease());
  const blink = walk.slotTimelineMut(headSlot).attachment;
  setKey(blink, 0, 'head', STEPPED);
  setKey(blink, 0.6, 'head_blink', STEPPED);
  setKey(blink, 0.7, 'head', STEPPED);

  const idle = new Animation('idle', 2);
  rot(idle, 'torso', [[0, 0], [1, 2], [2, 0]]);
  rot(idle, 'head', [[0, 0], [1, -5], [2, 0]]);
  rot(idle, 'upper_arm_front', [[0, 0], [1, 6], [2, 0]]);
  rot(idle, 'upper_arm_back', [[0, 0], [1, -6], [2, 0]]);
  const idleHip = idle.boneTimelineMut(idx('hip'));
  for (const [t, y] of [[0, 0], [1, -4], [2, 0]]) setKey(idleHip.translate, t, [0, y], ease());

  sk.animations = [walk, idle];
  const err = sk.validate();
  if (err) throw new Error(`sample is invalid: ${err}`);
  return sk;
}
