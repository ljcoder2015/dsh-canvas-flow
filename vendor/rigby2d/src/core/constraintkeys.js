// SPDX-License-Identifier: MIT OR Apache-2.0
// Keys of transform, path, physics and slider constraints. They are kept in the skeleton JSON
// layout in `anim.extra[type][constraint name]`: an array of keys (transform) or an object of
// arrays per channel (path, physics, slider), with 4.x absolute bezier curves.

import { setKey } from './animation.js';

/** Keyable channels per constraint type: [channel (null = the array itself), fields, defaults]. */
const CHANNELS = {
  transform: [[null, ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'], { mixRotate: 1, mixX: 1, mixScaleX: 1, mixShearY: 1 }]],
  path: [
    ['position', ['value'], { value: 0 }],
    ['spacing', ['value'], { value: 0 }],
    ['mix', ['mixRotate', 'mixX', 'mixY'], { mixRotate: 1, mixX: 1 }],
  ],
  physics: ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'].map((ch) => [ch, ['value'], { value: ch === 'mix' ? 1 : 0 }]),
  slider: [
    ['time', ['value'], { value: 0 }],
    ['mix', ['value'], { value: 1 }],
  ],
};

/** Value of a key field, with the format's defaults (mixY follows mixX, mixScaleY mixScaleX). */
export function keyField(key, field, defaults) {
  if (key[field] !== undefined) return key[field];
  if (field === 'mixY') return key.mixX ?? defaults.mixX ?? 1;
  if (field === 'mixScaleY') return key.mixScaleX ?? defaults.mixScaleX ?? 1;
  return defaults[field] ?? 0;
}

/** Channels of a constraint type: [{ channel, fields, defaults }]. */
export function constraintChannels(type) {
  return (CHANNELS[type] ?? []).map(([channel, fields, defaults]) => ({ channel, fields, defaults }));
}

/** The key list of one channel (created when `create`), with every key's time made explicit. */
export function channelKeys(anim, type, name, channel, create = false) {
  anim.extra ??= {};
  const byName = create ? (anim.extra[type] ??= {}) : anim.extra[type];
  if (!byName) return null;
  let keys;
  if (channel === null) keys = create ? (byName[name] ??= []) : byName[name];
  else {
    const channels = create ? (byName[name] ??= {}) : byName[name];
    keys = channels && (create ? (channels[channel] ??= []) : channels[channel]);
  }
  if (!Array.isArray(keys)) return null;
  for (const k of keys) k.time ??= 0;
  return keys;
}

/** Every keyed channel of the animation's non-IK constraints: [{ type, name, channel, keys, fields, defaults }]. */
export function keyedChannels(anim, constraints) {
  const out = [];
  for (const c of constraints) {
    if (c.type === 'ik') continue;
    for (const { channel, fields, defaults } of constraintChannels(c.type)) {
      const keys = channelKeys(anim, c.type, c.name, channel);
      if (keys?.length) out.push({ type: c.type, name: c.name, channel, keys, fields, defaults });
    }
  }
  return out;
}

/** Sets (or updates) the key at `time` of one channel to `values` ({ field: value }). */
export function setConstraintKey(anim, type, name, channel, time, values) {
  const keys = channelKeys(anim, type, name, channel, true);
  let key = keys.find((k) => Math.abs(k.time - time) < 5e-4);
  if (!key) {
    key = { time };
    keys.push(key);
    keys.sort((a, b) => a.time - b.time);
  }
  Object.assign(key, values);
  return key;
}

/** Sets an IK key (mix, softness, bend, compress, stretch) at `time`. */
export function setIkKey(anim, constraint, time, value) {
  let t = anim.ik.find((x) => x.constraint === constraint);
  if (!t) anim.ik.push((t = { constraint, keys: [] }));
  setKey(t.keys, time, { ...value });
}

/**
 * Sets the curve of key `i` (toward key i + 1) from a normalized preset: "linear", "stepped" or
 * a { bezier: [x1, y1, x2, y2] } curve, converted to absolute control points per field.
 */
export function setConstraintCurve(keys, i, fields, defaults, preset) {
  const a = keys[i];
  const b = keys[i + 1];
  if (preset === 'stepped') a.curve = 'stepped';
  else if (preset === 'linear' || !b || !preset?.bezier) delete a.curve;
  else {
    const [x1, y1, x2, y2] = preset.bezier;
    const dt = b.time - a.time;
    a.curve = fields.flatMap((f) => {
      const v0 = keyField(a, f, defaults);
      const dv = keyField(b, f, defaults) - v0;
      return [a.time + x1 * dt, v0 + y1 * dv, a.time + x2 * dt, v0 + y2 * dv];
    });
  }
}
