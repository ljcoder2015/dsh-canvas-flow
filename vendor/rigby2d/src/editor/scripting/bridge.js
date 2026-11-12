// SPDX-License-Identifier: MIT OR Apache-2.0
// The editor side of the Python `rigby` module. Scripts call `call(name, argsJson)`; arguments
// and results are JSON, so no Python or JavaScript objects are shared between the two. Every
// function works on the open project; the script runner turns a whole script or tool run into one
// undo step (or rolls it back when the script fails).

import { Animation, CHANNELS, setKey } from '../../core/animation.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED, isBezier } from '../../core/curve.js';
import { makeBone } from '../../core/model.js';
import { transform } from '../../core/math.js';

const CURVES = { linear: LINEAR, stepped: STEPPED, ease_in: EASE_IN, ease_out: EASE_OUT, ease_in_out: EASE_IN_OUT };
const SETUP_FIELDS = ['x', 'y', 'rotation', 'scale_x', 'scale_y', 'shear_x', 'shear_y'];
/** Keys closer than this (seconds) are the same key, as in the editor. */
const SAME_TIME = 5e-4;

/** An error a script can fix (wrong name, bad value): shown without the editor's stack. */
export class ScriptApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RigbyError';
  }
}

const fail = (message) => {
  throw new ScriptApiError(message);
};

function boneIndex(doc, name) {
  const i = doc.bones.findIndex((b) => b.name === name);
  if (i < 0) fail(`No bone '${name}'`);
  return i;
}

function slotIndex(doc, name) {
  const i = doc.slots.findIndex((s) => s.name === name);
  if (i < 0) fail(`No slot '${name}'`);
  return i;
}

function animationOf(app, name) {
  if (name === null || name === undefined) {
    const anim = app.currentAnimation();
    if (!anim) fail('No current animation: pass an animation name or open one');
    return anim;
  }
  return app.doc.animations.find((a) => a.name === name) ?? fail(`No animation '${name}'`);
}

function checkNumber(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a number`);
  return v;
}

function checkName(name, what) {
  if (typeof name !== 'string' || !name.trim()) fail(`The ${what} name must be a non-empty string`);
}

const curveName = (c) => (c === STEPPED ? 'stepped' : isBezier(c) ? Object.entries(CURVES).find(([, v]) => v === c)?.[0] ?? 'bezier' : 'linear');

const boneInfo = (doc, b) => ({ name: b.name, parent: b.parent === null ? null : doc.bones[b.parent].name, length: b.length, ...Object.fromEntries(SETUP_FIELDS.map((f) => [f, b.setup[f]])) });

const slotInfo = (doc, s) => ({ name: s.name, bone: doc.bones[s.bone].name, attachment: s.attachment, attachments: s.attachments.map((a) => a.name), color: [...s.color] });

/** Key value from a script value: rotate takes a number, the other channels [x, y]. */
function keyValue(channel, value) {
  if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'; use one of ${CHANNELS.join(', ')}`);
  if (channel === 'rotate') return checkNumber(value, 'A rotate key value');
  if (!Array.isArray(value) || value.length !== 2) fail(`A ${channel} key value must be [x, y]`);
  return [checkNumber(value[0], `${channel} x`), checkNumber(value[1], `${channel} y`)];
}

/** The API functions, by name. Each takes the app and the call's arguments object. */
export const API = {
  info(app) {
    const anim = app.currentAnimation();
    return {
      path: app.path,
      workspace: app.workspace,
      fps: app.doc.settings?.fps ?? 30,
      mode: app.mode,
      time: app.time,
      animation: anim?.name ?? null,
      skin: app.doc.skin ?? null,
    };
  },

  bones: (app) => app.doc.bones.map((b) => boneInfo(app.doc, b)),
  bone: (app, { name }) => boneInfo(app.doc, app.doc.bones[boneIndex(app.doc, name)]),

  add_bone(app, { name, parent = 'root', x = 0, y = 0, rotation = 0, length = 0 }) {
    const doc = app.doc;
    checkName(name, 'bone');
    if (doc.bones.some((b) => b.name === name)) fail(`A bone named '${name}' already exists`);
    const p = boneIndex(doc, parent);
    // Appending keeps every parent before its children and existing indices unchanged.
    doc.bones.push(makeBone(name, p, transform(checkNumber(x, 'x'), checkNumber(y, 'y'), checkNumber(rotation, 'rotation')), Math.max(0, checkNumber(length, 'length'))));
    return boneInfo(doc, doc.bones[doc.bones.length - 1]);
  },

  /** Changes a bone's setup pose (relative to its parent) and length. */
  set_bone(app, { name, fields }) {
    const bone = app.doc.bones[boneIndex(app.doc, name)];
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (k === 'length') bone.length = Math.max(0, checkNumber(v, 'length'));
      else if (SETUP_FIELDS.includes(k)) bone.setup[k] = checkNumber(v, k);
      else if (k === 'name') {
        checkName(v, 'bone');
        if (v !== bone.name && app.doc.bones.some((b) => b.name === v)) fail(`A bone named '${v}' already exists`);
        bone.name = v;
      } else fail(`Bones have no field '${k}'`);
    }
    return boneInfo(app.doc, bone);
  },

  /** A bone's world transform in the pose shown (the animation frame in Animate mode). */
  world(app, { name }) {
    const i = boneIndex(app.doc, name);
    const m = app.pose().world[i];
    return {
      x: m.tx,
      y: m.ty,
      rotation: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      scale_x: Math.hypot(m.a, m.b),
      scale_y: Math.hypot(m.c, m.d),
    };
  },

  slots: (app) => app.doc.slots.map((s) => slotInfo(app.doc, s)),

  /** Changes a slot's setup attachment (a name, or null to show nothing) and color [r, g, b, a]. */
  set_slot(app, { name, fields }) {
    const slot = app.doc.slots[slotIndex(app.doc, name)];
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (k === 'attachment') {
        if (v !== null && !slot.attachments.some((a) => a.name === v)) fail(`Slot '${slot.name}' has no attachment '${v}'`);
        slot.attachment = v;
      } else if (k === 'color') {
        if (!Array.isArray(v) || v.length !== 4) fail('color must be [r, g, b, a] with values 0..1');
        slot.color = v.map((c, i) => Math.max(0, Math.min(1, checkNumber(c, `color[${i}]`))));
      } else fail(`Slots have no field '${k}'`);
    }
    return slotInfo(app.doc, slot);
  },

  animations: (app) => app.doc.animations.map((a) => ({ name: a.name, duration: a.duration })),

  add_animation(app, { name, duration = 0 }) {
    checkName(name, 'animation');
    if (app.doc.animations.some((a) => a.name === name)) fail(`An animation named '${name}' already exists`);
    app.doc.animations.push(new Animation(name, Math.max(0, checkNumber(duration, 'duration'))));
    return { name, duration };
  },

  set_duration(app, { animation, duration }) {
    const anim = animationOf(app, animation);
    anim.duration = Math.max(0, checkNumber(duration, 'duration'));
    return { name: anim.name, duration: anim.duration };
  },

  /**
   * Sets a bone key (replacing one at the same time). Values are relative to the setup pose, as in
   * the editor: rotate adds degrees, translate and shear add [x, y], scale multiplies by [x, y].
   */
  set_key(app, { animation = null, bone, channel, time = null, value, curve = 'linear' }) {
    const anim = animationOf(app, animation);
    const b = boneIndex(app.doc, bone);
    const v = keyValue(channel, value);
    if (!(curve in CURVES)) fail(`Unknown curve '${curve}'; use one of ${Object.keys(CURVES).join(', ')}`);
    const t = Math.round(Math.max(0, checkNumber(time ?? app.time, 'time')) * 1e6) / 1e6;
    const keys = anim.boneTimelineMut(b)[channel];
    const i = setKey(keys, t, v);
    keys[i].curve = CURVES[curve];
    if (t > anim.duration) anim.duration = t;
    return { animation: anim.name, bone, channel, time: t, keys: keys.length };
  },

  delete_key(app, { animation = null, bone, channel, time = null }) {
    const anim = animationOf(app, animation);
    const b = boneIndex(app.doc, bone);
    if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'`);
    const t = time ?? app.time;
    const tl = anim.boneTimeline(b);
    const keys = tl?.[channel] ?? [];
    const i = keys.findIndex((k) => Math.abs(k.time - t) < SAME_TIME);
    if (i < 0) return false;
    keys.splice(i, 1);
    anim.prune();
    return true;
  },

  keys(app, { animation = null, bone, channel }) {
    const anim = animationOf(app, animation);
    if (!CHANNELS.includes(channel)) fail(`Unknown channel '${channel}'`);
    const tl = anim.boneTimeline(boneIndex(app.doc, bone));
    return (tl?.[channel] ?? []).map((k) => ({ time: k.time, value: Array.isArray(k.value) ? [...k.value] : k.value, curve: curveName(k.curve) }));
  },

  selection: (app) => app.selectedBones().map((i) => app.doc.bones[i].name),

  select(app, { names }) {
    const indices = (names ?? []).map((n) => boneIndex(app.doc, n));
    app.sel = indices.length ? { bone: indices[0] } : null;
    app.multi = new Set(indices);
    return indices.length;
  },

  set_time(app, { time }) {
    app.playing = false;
    app.time = Math.max(0, checkNumber(time, 'time'));
    return app.time;
  },

  set_animation(app, { name }) {
    const i = app.doc.animations.findIndex((a) => a.name === name);
    if (i < 0) fail(`No animation '${name}'`);
    app.anim = i;
    return name;
  },

  set_mode(app, { mode }) {
    if (mode !== 'setup' && mode !== 'animate') fail("mode must be 'setup' or 'animate'");
    if (mode === 'animate' && app.anim === null) fail('Open or add an animation before switching to animate mode');
    app.playing = false;
    app.mode = mode;
    return mode;
  },
};

/**
 * Calls API function `name` with JSON arguments; returns JSON. `hooks` receives log and status
 * calls (`log(level, text)`, `status(text)`), which are not project edits.
 */
export function callApi(app, hooks, name, argsJson) {
  const args = argsJson ? JSON.parse(argsJson) : {};
  if (name === 'log') return JSON.stringify(hooks.log(args.level, args.text) ?? null);
  if (name === 'status') return JSON.stringify(hooks.status(args.text) ?? null);
  const fn = Object.hasOwn(API, name) ? API[name] : null;
  if (!fn) throw new ScriptApiError(`Unknown function '${name}'`);
  return JSON.stringify(fn(app, args) ?? null);
}
