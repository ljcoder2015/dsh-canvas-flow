// SPDX-License-Identifier: MIT OR Apache-2.0
//! 2D math: local transforms and affine matrices. Y up, degrees, counter-clockwise rotation.

pub const DEG: f64 = std::f64::consts::PI / 180.0;

#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Wraps an angle in degrees to (-180, 180].
pub fn wrap_degrees(d: f64) -> f64 {
    let w = (((d + 180.0) % 360.0) + 360.0) % 360.0 - 180.0;
    if w == -180.0 {
        180.0
    } else {
        w
    }
}

/// `atan2(y, x)` in degrees.
#[inline]
pub fn angle_of(x: f64, y: f64) -> f64 {
    y.atan2(x) / DEG
}

/// A local transform. Shear is in degrees and tilts the X and Y axes independently.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub shear_x: f64,
    pub shear_y: f64,
}

impl Default for Transform {
    fn default() -> Self {
        Transform { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0, shear_x: 0.0, shear_y: 0.0 }
    }
}

impl Transform {
    /// The X axis points along rotation + shear_x; the Y axis along rotation + 90 + shear_y.
    pub fn to_affine(&self) -> Affine {
        let rx = (self.rotation + self.shear_x) * DEG;
        let ry = (self.rotation + 90.0 + self.shear_y) * DEG;
        Affine { a: rx.cos() * self.scale_x, b: rx.sin() * self.scale_x, c: ry.cos() * self.scale_y, d: ry.sin() * self.scale_y, tx: self.x, ty: self.y }
    }
}

/// 2D affine matrix mapping (x, y) to (a*x + c*y + tx, b*x + d*y + ty).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Default for Affine {
    fn default() -> Self {
        Affine::IDENTITY
    }
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 };

    pub fn new(a: f64, b: f64, c: f64, d: f64, tx: f64, ty: f64) -> Affine {
        Affine { a, b, c, d, tx, ty }
    }

    /// `self * r`: applies `r` first, then `self`.
    pub fn mul(&self, r: &Affine) -> Affine {
        Affine {
            a: self.a * r.a + self.c * r.b,
            b: self.b * r.a + self.d * r.b,
            c: self.a * r.c + self.c * r.d,
            d: self.b * r.c + self.d * r.d,
            tx: self.a * r.tx + self.c * r.ty + self.tx,
            ty: self.b * r.tx + self.d * r.ty + self.ty,
        }
    }

    pub fn determinant(&self) -> f64 {
        self.a * self.d - self.b * self.c
    }

    pub fn inverse(&self) -> Affine {
        let det = self.determinant();
        if det.abs() < 1e-12 {
            return Affine::IDENTITY;
        }
        let inv = 1.0 / det;
        let a = self.d * inv;
        let b = -self.b * inv;
        let c = -self.c * inv;
        let d = self.a * inv;
        Affine { a, b, c, d, tx: -(a * self.tx + c * self.ty), ty: -(b * self.tx + d * self.ty) }
    }

    #[inline]
    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        (self.a * x + self.c * y + self.tx, self.b * x + self.d * y + self.ty)
    }

    /// World rotation of the X axis, in degrees.
    pub fn rotation(&self) -> f64 {
        angle_of(self.a, self.b)
    }

    /// Decomposes into translation, rotation, scale and Y shear (shear_x is 0). Reflection is a
    /// negative Y scale.
    pub fn decompose(&self) -> Transform {
        let scale_x = self.a.hypot(self.b);
        if scale_x < 1e-12 {
            return Transform { x: self.tx, y: self.ty, rotation: 0.0, scale_x: 0.0, scale_y: 0.0, shear_x: 0.0, shear_y: 0.0 };
        }
        let rotation = self.rotation();
        let det = self.determinant();
        let scale_y = self.c.hypot(self.d) * if det < 0.0 { -1.0 } else { 1.0 };
        let y_angle = if scale_y == 0.0 { rotation + 90.0 } else { angle_of(self.c / scale_y, self.d / scale_y) };
        let shear_y = wrap_degrees(y_angle - rotation - 90.0);
        Transform { x: self.tx, y: self.ty, rotation, scale_x, scale_y, shear_x: 0.0, shear_y: if shear_y.abs() < 1e-9 { 0.0 } else { shear_y } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decompose_round_trips() {
        let t = Transform { x: 3.0, y: -2.0, rotation: 30.0, scale_x: 2.0, scale_y: -1.5, shear_x: 0.0, shear_y: 10.0 };
        let m = t.to_affine();
        let back = m.decompose().to_affine();
        for (p, q) in [(m.a, back.a), (m.b, back.b), (m.c, back.c), (m.d, back.d), (m.tx, back.tx), (m.ty, back.ty)] {
            assert!((p - q).abs() < 1e-9);
        }
        assert_eq!(wrap_degrees(-180.0), 180.0);
        assert_eq!(wrap_degrees(190.0), -170.0);
    }
}
