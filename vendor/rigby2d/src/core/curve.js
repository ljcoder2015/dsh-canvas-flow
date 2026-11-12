// SPDX-License-Identifier: MIT OR Apache-2.0
// Interpolation curves between keyframes.
//
// A curve is stored as one of:
//   "linear"
//   "stepped"                              holds the value until the next key
//   { bezier: [x1, y1, x2, y2] }           one cubic bezier shared by every value of the key
//   { beziers: [[x1, y1, x2, y2], ...] }   one bezier per value component (e.g. x and y)
// Bezier control points are normalized: endpoints are (0,0) and (1,1), x is the fraction of the
// time between the two keys and y the fraction of the value change.

export const LINEAR = 'linear';
export const STEPPED = 'stepped';
export const EASE_IN_OUT = Object.freeze({ bezier: Object.freeze([0.42, 0.0, 0.58, 1.0]) });
export const EASE_IN = Object.freeze({ bezier: Object.freeze([0.42, 0.0, 1.0, 1.0]) });
export const EASE_OUT = Object.freeze({ bezier: Object.freeze([0.0, 0.0, 0.58, 1.0]) });

const isObject = (c) => c !== null && typeof c === 'object';
const isQuad = (b) => Array.isArray(b) && b.length === 4;

export function isBezier(c) {
  return isObject(c) && (isQuad(c.bezier) || (Array.isArray(c.beziers) && c.beziers.length > 0));
}

/** Returns an independent, normalized copy of a curve (unknown values become linear). */
export function cloneCurve(c) {
  if (c === STEPPED) return STEPPED;
  let out = LINEAR;
  if (isObject(c) && isQuad(c.bezier)) out = { bezier: c.bezier.map(Number) };
  else if (isObject(c) && Array.isArray(c.beziers) && c.beziers.length && c.beziers.every(isQuad)) out = { beziers: c.beziers.map((b) => b.map(Number)) };
  // `src`: exact control points from an imported file, kept for lossless export.
  if (out !== LINEAR && isObject(c.src)) out.src = JSON.parse(JSON.stringify(c.src));
  return out;
}

export function curveEquals(a, b) {
  if (isObject(a) && isObject(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** The normalized bezier used for value `component`, or null for linear/stepped. */
export function bezierFor(curve, component = 0) {
  if (!isObject(curve)) return null;
  if (isQuad(curve.bezier)) return curve.bezier;
  if (Array.isArray(curve.beziers)) return curve.beziers[component] ?? curve.beziers[0] ?? null;
  return null;
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));

/** Maps linear progress `t` in [0, 1] to eased progress for value `component` of a key. */
export function ease(curve, t, component = 0) {
  t = clamp01(t);
  if (curve === STEPPED) return 0;
  const b = bezierFor(curve, component);
  return b ? bezierYForX(b[0], b[1], b[2], b[3], t) : t;
}

function cubic(p1, p2, t) {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}

function cubicDerivative(p1, p2, t) {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

function bezierYForX(x1, y1, x2, y2, x) {
  x1 = clamp01(x1);
  x2 = clamp01(x2);
  // Newton iterations, falling back to bisection when the slope is too flat.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = cubic(x1, x2, t) - x;
    if (Math.abs(err) < 1e-5) return cubic(y1, y2, t);
    const d = cubicDerivative(x1, x2, t);
    if (Math.abs(d) < 1e-6) break;
    t = clamp01(t - err / d);
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 30; i++) {
    const v = cubic(x1, x2, t);
    if (Math.abs(v - x) < 1e-5) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) * 0.5;
  }
  return cubic(y1, y2, t);
}
