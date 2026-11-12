// SPDX-License-Identifier: MIT OR Apache-2.0
// Minimal 2D math: local transforms and affine matrices.
//
// Rigby2D uses a Y-up coordinate system with rotations in degrees, counter-clockwise.
// A transform is a plain object { x, y, rotation, scale_x, scale_y, shear_x, shear_y }; shear is
// in degrees and tilts the X and Y axes independently (0 = no shear).

const DEG = Math.PI / 180;

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** A transform with translation and rotation (scale 1, no shear). */
export function transform(x = 0, y = 0, rotation = 0) {
  return { x, y, rotation, scale_x: 1, scale_y: 1, shear_x: 0, shear_y: 0 };
}

export function identityTransform() {
  return transform();
}

/** Copies transform `src` into `dst` and returns `dst`. */
export function copyTransform(src, dst) {
  dst.x = src.x;
  dst.y = src.y;
  dst.rotation = src.rotation;
  dst.scale_x = src.scale_x;
  dst.scale_y = src.scale_y;
  dst.shear_x = src.shear_x ?? 0;
  dst.shear_y = src.shear_y ?? 0;
  return dst;
}

export function cloneTransform(t) {
  return {
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    scale_x: t.scale_x,
    scale_y: t.scale_y,
    shear_x: t.shear_x ?? 0,
    shear_y: t.shear_y ?? 0,
  };
}

export function transformEquals(a, b) {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.scale_x === b.scale_x &&
    a.scale_y === b.scale_y &&
    (a.shear_x ?? 0) === (b.shear_x ?? 0) &&
    (a.shear_y ?? 0) === (b.shear_y ?? 0)
  );
}

/**
 * The X axis points along rotation + shear_x; the Y axis along rotation + 90 + shear_y. Writes
 * into `out` when given.
 */
export function toAffine(t, out = new Affine()) {
  const rx = (t.rotation + (t.shear_x ?? 0)) * DEG;
  const ry = (t.rotation + 90 + (t.shear_y ?? 0)) * DEG;
  return out.set(
    Math.cos(rx) * t.scale_x,
    Math.sin(rx) * t.scale_x,
    Math.cos(ry) * t.scale_y,
    Math.sin(ry) * t.scale_y,
    t.x,
    t.y,
  );
}

/** Linear interpolation between two transforms (rotation is not wrapped). */
export function lerpTransform(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    rotation: lerp(a.rotation, b.rotation, t),
    scale_x: lerp(a.scale_x, b.scale_x, t),
    scale_y: lerp(a.scale_y, b.scale_y, t),
    shear_x: lerp(a.shear_x ?? 0, b.shear_x ?? 0, t),
    shear_y: lerp(a.shear_y ?? 0, b.shear_y ?? 0, t),
  };
}

/** Wraps an angle in degrees to (-180, 180]. */
export function wrapDegrees(d) {
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** 2D affine matrix mapping (x, y) to (a*x + c*y + tx, b*x + d*y + ty). */
export class Affine {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
  }

  static identity() {
    return new Affine();
  }

  clone() {
    return new Affine(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }

  set(a, b, c, d, tx, ty) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    return this;
  }

  /** Writes `l * r` into `out` (which may be `l` or `r`) and returns it. */
  static multiply(l, r, out) {
    return out.set(
      l.a * r.a + l.c * r.b,
      l.b * r.a + l.d * r.b,
      l.a * r.c + l.c * r.d,
      l.b * r.c + l.d * r.d,
      l.a * r.tx + l.c * r.ty + l.tx,
      l.b * r.tx + l.d * r.ty + l.ty,
    );
  }

  /** `this * rhs`: applies `rhs` first, then `this`. */
  mul(r) {
    return new Affine(
      this.a * r.a + this.c * r.b,
      this.b * r.a + this.d * r.b,
      this.a * r.c + this.c * r.d,
      this.b * r.c + this.d * r.d,
      this.a * r.tx + this.c * r.ty + this.tx,
      this.b * r.tx + this.d * r.ty + this.ty,
    );
  }

  determinant() {
    return this.a * this.d - this.b * this.c;
  }

  inverse() {
    const det = this.determinant();
    if (Math.abs(det) < 1e-12) return new Affine();
    const inv = 1 / det;
    const a = this.d * inv;
    const b = -this.b * inv;
    const c = -this.c * inv;
    const d = this.a * inv;
    return new Affine(a, b, c, d, -(a * this.tx + c * this.ty), -(b * this.tx + d * this.ty));
  }

  apply(p) {
    return [this.a * p[0] + this.c * p[1] + this.tx, this.b * p[0] + this.d * p[1] + this.ty];
  }

  /** Applies only the linear part (no translation), for direction vectors. */
  applyVector(v) {
    return [this.a * v[0] + this.c * v[1], this.b * v[0] + this.d * v[1]];
  }

  /** World rotation of the X axis, in degrees. */
  rotation() {
    return Math.atan2(this.b, this.a) / DEG;
  }

  /**
   * Decomposes into translation, rotation, scale and Y shear (shear_x is always 0). Reflection is
   * expressed as a negative Y scale.
   */
  decompose() {
    const scale_x = Math.hypot(this.a, this.b);
    if (scale_x < 1e-12) return { x: this.tx, y: this.ty, rotation: 0, scale_x: 0, scale_y: 0, shear_x: 0, shear_y: 0 };
    const rotation = this.rotation();
    const det = this.determinant();
    const scale_y = Math.hypot(this.c, this.d) * (det < 0 ? -1 : 1);
    const yAngle = scale_y === 0 ? rotation + 90 : Math.atan2(this.d / scale_y, this.c / scale_y) / DEG;
    const shear_y = wrapDegrees(yAngle - rotation - 90);
    return { x: this.tx, y: this.ty, rotation, scale_x, scale_y, shear_x: 0, shear_y: Math.abs(shear_y) < 1e-9 ? 0 : shear_y };
  }
}
