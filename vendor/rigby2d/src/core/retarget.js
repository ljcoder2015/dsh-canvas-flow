// SPDX-License-Identifier: MIT OR Apache-2.0
// Animation retargeting: plays an animation made for one character on another. Bones are matched
// by name, then by body part (so "L_UpperArm" finds "upperarm_l"); movement is scaled to the
// target's size and turned into its bones' frames; slot, event and IK keys follow by name.

import { Animation } from './animation.js';
import { cloneCurve } from './curve.js';
import { Pose } from './pose.js';
import { boneKey, normalizedName } from './bodyparts.js';

/**
 * Matches the bones of `source` to bones of `target`. `overrides` maps source bone names to target
 * bone names (or null to leave one out). Returns { pairs: [{ source, target, how }], unmapped }
 * with bone indices; `how` is 'manual', 'name', 'similar name', 'body part' or 'root'.
 */
export function mapBones(source, target, overrides = {}) {
  const used = new Set();
  const pairs = [];
  const unmapped = [];
  const take = (s, t, how) => {
    used.add(t);
    pairs.push({ source: s, target: t, how });
  };
  const free = (pred) => target.bones.findIndex((b, i) => !used.has(i) && pred(b, i));
  // Manual choices first, so automatic matches cannot take their bones.
  source.bones.forEach((b, s) => {
    if (!(b.name in overrides) || overrides[b.name] === null) return;
    const t = target.boneIndex(overrides[b.name]);
    if (t === null) throw new Error(`Mapping: the target has no bone '${overrides[b.name]}'`);
    take(s, t, 'manual');
  });
  const done = new Set(pairs.map((p) => p.source));
  source.bones.forEach((b, s) => {
    if (done.has(s) || (b.name in overrides && overrides[b.name] === null)) return;
    let t = free((tb) => tb.name === b.name);
    let how = 'name';
    if (t < 0) [t, how] = [free((tb) => normalizedName(tb.name) === normalizedName(b.name)), 'similar name'];
    const key = boneKey(b.name);
    if (t < 0 && key) [t, how] = [free((tb) => boneKey(tb.name) === key), 'body part'];
    if (t < 0 && s === 0 && !used.has(0)) [t, how] = [0, 'root'];
    if (t >= 0) take(s, t, how);
    else unmapped.push(s);
  });
  pairs.sort((a, b) => a.source - b.source);
  return { pairs, unmapped };
}

/** Height of a skeleton in its setup pose: from the lowest to the highest bone end. */
export function skeletonHeight(doc) {
  const pose = new Pose(doc);
  let lo = Infinity;
  let hi = -Infinity;
  doc.bones.forEach((b, i) => {
    for (const p of [pose.world[i].apply([0, 0]), pose.world[i].apply([b.length, 0])]) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
  });
  return hi - lo;
}

const cloneKey = (k, value) => ({ time: k.time, value, curve: cloneCurve(k.curve) });
const copyValue = (v) => (Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

/**
 * Retargets animation `animationName` of `source` onto `target`, adding it as `name` (default: the
 * same name; an existing animation is replaced only with `replace`). Options:
 * - mapping: { sourceBone: targetBone | null } overrides the automatic matching;
 * - scale: number, or 'auto' (default) for target height / source height: moves scale by it;
 * - mode: 'relative' (default) copies rotations relative to each rig's setup pose, keeping the
 *   target's own rest pose; 'world' makes bones point the same way as the source's in the world,
 *   which compensates for different rest poses (arms down versus arms out).
 * Returns { animation, report }.
 */
export function retarget(source, animationName, target, options = {}) {
  const src = source.animations.find((a) => a.name === animationName);
  if (!src) throw new Error(`The source has no animation '${animationName}'`);
  const name = options.name ?? animationName;
  const existing = target.animations.findIndex((a) => a.name === name);
  if (existing >= 0 && !options.replace) throw new Error(`The target already has an animation '${name}' (pass replace to overwrite it)`);
  const mode = options.mode ?? 'relative';
  const sh = skeletonHeight(source);
  const scale = typeof options.scale === 'number' ? options.scale : sh > 1e-6 ? skeletonHeight(target) / sh : 1;
  const { pairs, unmapped } = mapBones(source, target, options.mapping ?? {});
  const toTarget = new Map(pairs.map((p) => [p.source, p.target]));

  const out = new Animation(name, src.duration);
  const sPose = new Pose(source);
  const tPose = new Pose(target);
  const skipped = [];
  let keys = 0;

  // Bones, parents first so world-mode rotations can see their parents' new keys.
  const timelines = src.bones.filter((tl) => toTarget.has(tl.bone)).sort((a, b) => toTarget.get(a.bone) - toTarget.get(b.bone));
  for (const tl of timelines) {
    const sb = tl.bone;
    const tb = toTarget.get(sb);
    const dst = out.boneTimelineMut(tb);
    const sParent = source.bones[sb].parent;
    const tParent = target.bones[tb].parent;
    const sFrame = sParent === null ? null : sPose.world[sParent];
    const tFrame = tParent === null ? null : tPose.world[tParent];
    // A parent mirrored in one rig but not the other turns rotations the other way.
    const mirrored = (sFrame?.determinant() ?? 1) * (tFrame?.determinant() ?? 1) < 0;
    const sign = mirrored ? -1 : 1;
    // Offsets are in the parent bone's frame: through the world into the target parent's frame.
    const move = (v) => {
      const w = sFrame ? sFrame.applyVector(v) : v;
      const scaled = [w[0] * scale, w[1] * scale];
      const v2 = tFrame ? tFrame.inverse().applyVector(scaled) : scaled;
      // Frame rotations leave float noise (1e-31) where values were exactly 0.
      return v2.map((x) => (Math.abs(x) < 1e-9 ? 0 : Math.round(x * 1e6) / 1e6));
    };
    for (const k of tl.rotate) {
      let value = k.value * sign;
      if (mode === 'world') {
        const sp = new Pose(source);
        sp.apply(source, src, k.time, 1);
        sp.updateWorld(source);
        const tp = new Pose(target);
        tp.apply(target, out, k.time, 1);
        tp.updateWorld(target);
        const parentAngle = tParent === null ? 0 : tp.world[tParent].rotation();
        value = wrap(sp.world[sb].rotation() - parentAngle - target.bones[tb].setup.rotation);
        // Continue from the previous key, so interpolation never spins the long way round.
        const prev = dst.rotate.at(-1);
        if (prev) value = prev.value + wrap(value - prev.value);
      }
      dst.rotate.push(cloneKey(k, value));
    }
    for (const k of tl.translate) dst.translate.push(cloneKey(k, move(k.value)));
    for (const ch of ['translateX', 'translateY']) for (const k of tl[ch]) dst[ch].push(cloneKey(k, k.value * scale));
    for (const ch of ['scale', 'scaleX', 'scaleY', 'inherit']) for (const k of tl[ch]) dst[ch].push(cloneKey(k, copyValue(k.value)));
    for (const ch of ['shear', 'shearX', 'shearY']) for (const k of tl[ch]) dst[ch].push(cloneKey(k, Array.isArray(k.value) ? k.value.map((v) => v * sign) : k.value * sign));
    keys += ['rotate', 'translate', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'shear', 'shearX', 'shearY', 'inherit'].reduce((n, ch) => n + tl[ch].length, 0);
  }
  const lost = src.bones.filter((tl) => !toTarget.has(tl.bone));
  if (lost.length) skipped.push(`keys of unmatched bones: ${lost.map((tl) => source.bones[tl.bone].name).join(', ')}`);

  // Slots by name: attachment keys only for images the target slot has.
  let missingImages = 0;
  for (const tl of src.slots) {
    const sname = source.slots[tl.slot].name;
    const ts = target.slots.findIndex((s) => s.name === sname || normalizedName(s.name) === normalizedName(sname));
    if (ts < 0) {
      skipped.push(`slot '${sname}' (not in the target)`);
      continue;
    }
    const dst = out.slotTimelineMut(ts);
    for (const [ch, list] of Object.entries(tl)) {
      if (ch === 'slot' || !Array.isArray(list)) continue;
      for (const k of list) {
        if (ch === 'attachment' && k.value !== null && !target.attachment(ts, k.value, null) && !target.skins.some((sk) => sk.slots.some((e) => e.slot === ts && e.attachments.some((a) => a.name === k.value)))) {
          missingImages++;
          continue;
        }
        dst[ch].push(cloneKey(k, copyValue(k.value)));
      }
    }
  }
  if (missingImages) skipped.push(`${missingImages} image swap key(s) for images the target does not have`);

  // Events (definitions are added to the target when missing) and IK mixes by constraint name.
  for (const e of src.events) {
    if (!target.events.some((d) => d.name === e.name)) {
      const def = source.events.find((d) => d.name === e.name);
      target.events.push(def ? JSON.parse(JSON.stringify(def)) : { name: e.name, int: 0, float: 0, string: null, audio: null, volume: 1, balance: 0 });
    }
    out.events.push({ ...e });
  }
  for (const tl of src.ik) {
    const cname = source.ik[tl.constraint]?.name;
    const tc = target.ik.findIndex((c) => c.name === cname);
    if (tc < 0) {
      skipped.push(`IK constraint '${cname}' (not in the target)`);
      continue;
    }
    out.ik.push({ constraint: tc, keys: tl.keys.map((k) => cloneKey(k, copyValue(k.value))) });
  }
  if (src.deform.length) skipped.push('mesh deformation keys (meshes differ between characters)');
  if (src.drawOrder.length) skipped.push('draw order keys');

  out.prune();
  if (existing >= 0) target.animations[existing] = out;
  else target.animations.push(out);
  const err = target.validate();
  if (err) throw new Error(`Retargeting made invalid data: ${err}`);
  return {
    animation: out,
    report: {
      animation: name,
      mode,
      scale,
      keys,
      mapped: pairs.map((p) => ({ source: source.bones[p.source].name, target: target.bones[p.target].name, how: p.how })),
      unmatched: unmapped.map((i) => source.bones[i].name),
      skipped,
    },
  };
}

function wrap(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}
