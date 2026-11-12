// SPDX-License-Identifier: MIT OR Apache-2.0
// A layered test character for AutoRig and retargeting tests.

import { Skeleton, makeAttachment, makeSlot } from '../../src/core/model.js';
import { transform } from '../../src/core/math.js';

/** Artwork like a PSD import: one region per layer on the root, plus each layer's alpha (an ellipse). */
export function figure(layers) {
  const doc = new Skeleton();
  const alpha = new Map();
  for (const [name, x, y, w, h, rotation = 0] of layers) {
    const att = makeAttachment(name, name, transform(x, y, rotation), w, h);
    doc.images.push({ name, path: null, width: w, height: h });
    doc.slots.push(makeSlot(name, 0, att));
    const data = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) if (((px + 0.5 - w / 2) / (w / 2)) ** 2 + ((py + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) data[py * w + px] = 255;
    alpha.set(name, { width: w, height: h, data });
  }
  return { doc, alphaOf: (n) => alpha.get(n) ?? null };
}

/** A front-facing character, feet at y = 0. Its left side is on the image's right (x > 0). */
export const CHARACTER = [
  ['leg_r', -25, 80, 30, 160],
  ['thigh_l', 25, 120, 32, 85],
  ['shin_l', 25, 45, 28, 80],
  ['foot_l', 38, 8, 50, 18],
  ['Body', 0, 230, 110, 170],
  ['arm_r', -72, 225, 24, 150],
  ['upperarm_l', 72, 262, 24, 80],
  ['forearm_l', 72, 190, 22, 76],
  ['hand_l', 72, 140, 30, 30],
  ['Head', 0, 370, 100, 100],
  ['eye_l', 20, 380, 16, 16],
  ['eye_r', -20, 380, 16, 16],
  ['mouth', 0, 345, 30, 10],
  ['Layer 7', 0, 260, 30, 30],
];

