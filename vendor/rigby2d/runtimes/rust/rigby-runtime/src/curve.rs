// SPDX-License-Identifier: MIT OR Apache-2.0
//! Interpolation curves between keys. Bezier control points are normalized: endpoints (0,0) and
//! (1,1), x the fraction of the time between the keys, y the fraction of the value change.

#[derive(Clone, Debug, PartialEq)]
pub enum Curve {
    Linear,
    /// Holds the value until the next key.
    Stepped,
    /// One bezier shared by every value of the key.
    Bezier([f64; 4]),
    /// One bezier per value component.
    Beziers(Vec<[f64; 4]>),
}

impl Curve {
    fn bezier_for(&self, component: usize) -> Option<&[f64; 4]> {
        match self {
            Curve::Bezier(b) => Some(b),
            Curve::Beziers(list) => list.get(component).or_else(|| list.first()),
            _ => None,
        }
    }

    /// Maps linear progress `t` to eased progress for value `component` of a key.
    pub fn ease(&self, t: f64, component: usize) -> f64 {
        let t = clamp01(t);
        if *self == Curve::Stepped {
            return 0.0;
        }
        match self.bezier_for(component) {
            Some(b) => bezier_y_for_x(b[0], b[1], b[2], b[3], t),
            None => t,
        }
    }
}

#[inline]
fn clamp01(t: f64) -> f64 {
    t.clamp(0.0, 1.0)
}

#[inline]
fn cubic(p1: f64, p2: f64, t: f64) -> f64 {
    let u = 1.0 - t;
    3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t
}

#[inline]
fn cubic_derivative(p1: f64, p2: f64, t: f64) -> f64 {
    let u = 1.0 - t;
    3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (1.0 - p2)
}

fn bezier_y_for_x(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    let x1 = clamp01(x1);
    let x2 = clamp01(x2);
    // Newton iterations, falling back to bisection when the slope is too flat.
    let mut t = x;
    for _ in 0..8 {
        let err = cubic(x1, x2, t) - x;
        if err.abs() < 1e-5 {
            return cubic(y1, y2, t);
        }
        let d = cubic_derivative(x1, x2, t);
        if d.abs() < 1e-6 {
            break;
        }
        t = clamp01(t - err / d);
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    t = x;
    for _ in 0..30 {
        let v = cubic(x1, x2, t);
        if (v - x).abs() < 1e-5 {
            break;
        }
        if v < x {
            lo = t;
        } else {
            hi = t;
        }
        t = (lo + hi) * 0.5;
    }
    cubic(y1, y2, t)
}

// ---- raw curves (constraint keys, as stored in the file) -------------------------------------

/// A curve as stored in a file key: used for constraint keys, which are sampled from file data.
#[derive(Clone, Debug, PartialEq)]
pub enum RawCurve {
    Linear,
    Stepped,
    /// 4.x: absolute control points, 4 per value.
    Absolute(Vec<f64>),
    /// 3.8: one normalized bezier.
    Normalized([f64; 4]),
}

/// A constraint key: time, values and the curve to the next key.
#[derive(Clone, Debug)]
pub struct RawKey {
    pub time: f64,
    pub values: Vec<f64>,
    pub curve: RawCurve,
}

/// Samples raw keys at `time` (keys must not be empty).
pub fn sample_raw(keys: &[RawKey], time: f64, out: &mut Vec<f64>) {
    out.clear();
    if time < keys[0].time {
        out.extend_from_slice(&keys[0].values);
        return;
    }
    let mut i = 0;
    while i + 1 < keys.len() && keys[i + 1].time <= time {
        i += 1;
    }
    let a = &keys[i];
    let Some(b) = keys.get(i + 1) else {
        out.extend_from_slice(&a.values);
        return;
    };
    if a.curve == RawCurve::Stepped {
        out.extend_from_slice(&a.values);
        return;
    }
    let (t0, t1) = (a.time, b.time);
    if t1 <= t0 {
        out.extend_from_slice(&b.values);
        return;
    }
    for (j, &v0) in a.values.iter().enumerate() {
        let v1 = b.values.get(j).copied().unwrap_or(f64::NAN);
        let v = match &a.curve {
            RawCurve::Absolute(c) if c.len() >= 4 * (j + 1) && c.len() >= 4 * a.values.len() => {
                bezier_at(t0, v0, c[4 * j], c[4 * j + 1], c[4 * j + 2], c[4 * j + 3], t1, v1, time)
            }
            RawCurve::Absolute(c) if c.len() == 4 => {
                let u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
                v0 + (v1 - v0) * u
            }
            RawCurve::Normalized(c) => {
                let u = normalized_bezier(c[0], c[1], c[2], c[3], (time - t0) / (t1 - t0));
                v0 + (v1 - v0) * u
            }
            _ => v0 + (v1 - v0) * ((time - t0) / (t1 - t0)),
        };
        out.push(v);
    }
}

#[inline]
pub fn cubic4(p0: f64, p1: f64, p2: f64, p3: f64, s: f64) -> f64 {
    let u = 1.0 - s;
    u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3
}

/// Value of an absolute bezier segment from (x0, y0) to (x3, y3) at x.
#[allow(clippy::too_many_arguments)]
fn bezier_at(x0: f64, y0: f64, x1: f64, y1: f64, x2: f64, y2: f64, x3: f64, y3: f64, x: f64) -> f64 {
    let (mut lo, mut hi) = (0.0, 1.0);
    let mut s = (x - x0) / (x3 - x0);
    for _ in 0..40 {
        let v = cubic4(x0, x1, x2, x3, s);
        if (v - x).abs() < 1e-7 {
            break;
        }
        if v < x {
            lo = s;
        } else {
            hi = s;
        }
        s = (lo + hi) / 2.0;
    }
    cubic4(y0, y1, y2, y3, s)
}

fn normalized_bezier(x1: f64, y1: f64, x2: f64, y2: f64, x: f64) -> f64 {
    bezier_at(0.0, 0.0, x1, y1, x2, y2, 1.0, 1.0, x)
}
