// SPDX-License-Identifier: MIT OR Apache-2.0
// Pose library and facial controllers. A pose stores local transforms of bones and the attachment
// shown by slots, by name (so it survives reordering). Controllers blend between two poses (or
// the setup pose) with one value from 0 to 1, for faces: brows, eyelids, mouth shapes.

import { lerp, wrapDegrees } from './math.js';

const FIELDS = ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'];

/**
 * Captures a pose from `pose` (a Pose of `doc`): local transforms of `bones` (indices) and, for
 * `slots` (indices), the attachment each shows.
 */
export function capturePose(doc, pose, name, bones, slots) {
  const out = { name, bones: {}, slots: {} };
  for (const b of bones) {
    const t = pose.local[b];
    out.bones[doc.bones[b].name] = Object.fromEntries(FIELDS.map((f) => [f, t[f] ?? 0]));
  }
  for (const s of slots) out.slots[doc.slots[s].name] = pose.attachment[s] ?? null;
  return out;
}

/** Bones and slots of `doc` a pose refers to (names that no longer exist are skipped). */
export function poseTargets(doc, saved) {
  const bones = Object.keys(saved?.bones ?? {})
    .map((n) => doc.bones.findIndex((b) => b.name === n))
    .filter((i) => i >= 0);
  const slots = Object.keys(saved?.slots ?? {})
    .map((n) => doc.slots.findIndex((s) => s.name === n))
    .filter((i) => i >= 0);
  return { bones, slots };
}

function transformOf(doc, saved, bone, fallback) {
  const t = saved?.bones?.[doc.bones[bone].name];
  return t ? { ...fallback, ...t } : fallback;
}

function blendTransform(a, b, amount) {
  const out = {};
  for (const f of FIELDS) {
    const va = a[f] ?? 0;
    const vb = b[f] ?? 0;
    // Rotations blend the short way around.
    out[f] = f === 'rotation' ? va + wrapDegrees(vb - va) * amount : lerp(va, vb, amount);
  }
  return out;
}

/**
 * Local transforms and attachments for blending from pose `from` to pose `to` by `amount` (0..1).
 * `from` null means the setup pose; `current` (a Pose) gives values for bones only one side
 * stores. `setup` optionally replaces the skeleton's setup values ({ bones: Map(bone ->
 * transform), slots: Map(slot -> attachment) }), so a drag that edits the setup pose keeps blending
 * from where it started. Attachments switch at the halfway point. Returns { bones: Map(bone ->
 * transform), slots: Map(slot -> attachment name or null) }.
 */
export function blendPoses(doc, current, from, to, amount, setup = null) {
  const setupOf = (bone) => setup?.bones.get(bone) ?? doc.bones[bone].setup;
  const setupSlot = (slot) => (setup?.slots.has(slot) ? setup.slots.get(slot) : doc.slots[slot].attachment);
  const bones = new Map();
  const slots = new Map();
  const a = poseTargets(doc, from);
  const b = poseTargets(doc, to);
  for (const bone of new Set([...a.bones, ...b.bones])) {
    const base = from ? current.local[bone] : setupOf(bone);
    const t0 = transformOf(doc, from, bone, base);
    const t1 = transformOf(doc, to, bone, base);
    bones.set(bone, blendTransform(t0, t1, amount));
  }
  for (const slot of new Set([...a.slots, ...b.slots])) {
    const name = doc.slots[slot].name;
    const start = from ? (name in from.slots ? from.slots[name] : current.attachment[slot]) : setupSlot(slot);
    const end = to && name in to.slots ? to.slots[name] : start;
    slots.set(slot, amount >= 0.5 ? end : start);
  }
  return { bones, slots };
}

/** Applying a pose at `amount`: a blend from the current pose. */
export function applyAmount(doc, current, saved, amount) {
  const { bones, slots } = poseTargets(doc, saved);
  const out = { bones: new Map(), slots: new Map() };
  for (const bone of bones) out.bones.set(bone, blendTransform(current.local[bone], transformOf(doc, saved, bone, current.local[bone]), amount));
  if (amount >= 0.5) for (const slot of slots) out.slots.set(slot, saved.slots[doc.slots[slot].name]);
  return out;
}

/** Validated poses from stored data. */
export function readPoses(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.name === 'string')
    .map((p) => ({
      name: p.name,
      bones: Object.fromEntries(
        Object.entries(p.bones ?? {})
          .filter(([, t]) => t && typeof t === 'object')
          .map(([n, t]) => [n, Object.fromEntries(FIELDS.map((f) => [f, typeof t[f] === 'number' && Number.isFinite(t[f]) ? t[f] : f.startsWith('scale') ? 1 : 0]))]),
      ),
      slots: Object.fromEntries(Object.entries(p.slots ?? {}).map(([n, a]) => [n, typeof a === 'string' ? a : null])),
    }));
}

/** Validated controllers: { name, from (pose name or null = setup pose), to (pose name), value }. */
export function readControllers(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c.name === 'string' && typeof c.to === 'string')
    .map((c) => ({ name: c.name, from: typeof c.from === 'string' ? c.from : null, to: c.to, value: typeof c.value === 'number' ? Math.min(1, Math.max(0, c.value)) : 0 }));
}
