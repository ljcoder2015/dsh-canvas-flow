// SPDX-License-Identifier: MIT OR Apache-2.0
//! Clipping attachments: a polygon that masks the slots drawn after it (up to its end slot). The
//! polygon is split into triangles (it may be concave) and each drawn triangle is clipped against
//! each of them, interpolating UVs.

/// Signed area of a flat [x, y, ...] polygon (positive when counter-clockwise, Y up).
fn signed_area(p: &[f64]) -> f64 {
    let n = p.len();
    let mut a = 0.0;
    let mut i = 0;
    while i + 1 < n {
        let j = (i + 2) % n;
        a += p[i] * p[j + 1] - p[j] * p[i + 1];
        i += 2;
    }
    a / 2.0
}

/// Ear-clipping triangulation of a simple polygon; counter-clockwise triangles (6 floats each).
pub fn triangulate(polygon: &[f64]) -> Vec<[f64; 6]> {
    let mut p = polygon.to_vec();
    if signed_area(&p) < 0.0 {
        let mut r = Vec::with_capacity(p.len());
        let mut i = p.len() as isize - 2;
        while i >= 0 {
            r.push(p[i as usize]);
            r.push(p[i as usize + 1]);
            i -= 2;
        }
        p = r;
    }
    let mut idx: Vec<usize> = (0..p.len() / 2).collect();
    let x = |i: usize| p[2 * i];
    let y = |i: usize| p[2 * i + 1];
    let cross = |a: usize, b: usize, c: usize| (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
    let inside = |a: usize, b: usize, c: usize, q: usize| cross(a, b, q) >= 0.0 && cross(b, c, q) >= 0.0 && cross(c, a, q) >= 0.0;
    let mut out = Vec::new();
    let mut guard = 0;
    while idx.len() > 3 && guard < 10000 {
        guard += 1;
        let mut clipped = false;
        for k in 0..idx.len() {
            let a = idx[(k + idx.len() - 1) % idx.len()];
            let b = idx[k];
            let c = idx[(k + 1) % idx.len()];
            if cross(a, b, c) <= 0.0 {
                continue; // reflex or degenerate corner
            }
            if idx.iter().any(|&q| q != a && q != b && q != c && inside(a, b, c, q)) {
                continue;
            }
            out.push([x(a), y(a), x(b), y(b), x(c), y(c)]);
            idx.remove(k);
            clipped = true;
            break;
        }
        if !clipped {
            break; // self-intersecting input: keep what we have
        }
    }
    if idx.len() == 3 {
        out.push([x(idx[0]), y(idx[0]), x(idx[1]), y(idx[1]), x(idx[2]), y(idx[2])]);
    }
    out
}

#[derive(Clone, Copy, Debug)]
struct V {
    x: f64,
    y: f64,
    u: f64,
    v: f64,
}

/// Clips a convex polygon against a counter-clockwise triangle (Sutherland-Hodgman).
fn clip_convex(poly: &[V], tri: &[f64; 6], out: &mut Vec<V>, tmp: &mut Vec<V>) {
    out.clear();
    out.extend_from_slice(poly);
    for e in 0..3 {
        if out.is_empty() {
            break;
        }
        let (ax, ay) = (tri[2 * e], tri[2 * e + 1]);
        let (bx, by) = (tri[(2 * e + 2) % 6], tri[(2 * e + 3) % 6]);
        let side = |p: &V| (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
        std::mem::swap(out, tmp);
        out.clear();
        for i in 0..tmp.len() {
            let p = tmp[i];
            let q = tmp[(i + 1) % tmp.len()];
            let (sp, sq) = (side(&p), side(&q));
            if sp >= 0.0 {
                out.push(p);
            }
            if (sp >= 0.0) != (sq >= 0.0) {
                let t = sp / (sp - sq);
                out.push(V { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
            }
        }
    }
}

/// An active clipping region: triangles of the clip polygon in world space.
pub struct Clipper {
    triangles: Vec<[f64; 6]>,
}

impl Clipper {
    pub fn new(polygon: &[f64]) -> Clipper {
        Clipper { triangles: triangulate(polygon) }
    }

    /// Clips a triangle mesh (flat positions and UVs, vertex indices), appending the result.
    pub fn clip(&self, positions: &[f64], uvs: &[f64], triangles: &[u32], out_p: &mut Vec<f64>, out_uv: &mut Vec<f64>, out_t: &mut Vec<u32>) {
        let vertex = |i: u32| {
            let i = i as usize;
            V { x: positions[2 * i], y: positions[2 * i + 1], u: uvs[2 * i], v: uvs[2 * i + 1] }
        };
        let (mut poly, mut tmp) = (Vec::with_capacity(9), Vec::with_capacity(9));
        for t in triangles.as_chunks::<3>().0 {
            let mut tri = [vertex(t[0]), vertex(t[1]), vertex(t[2])];
            // Counter-clockwise, so "inside" is on the left of every edge.
            let area = (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
            if area < 0.0 {
                tri.swap(1, 2);
            }
            for clip in &self.triangles {
                clip_convex(&tri, clip, &mut poly, &mut tmp);
                if poly.len() < 3 {
                    continue;
                }
                let base = (out_p.len() / 2) as u32;
                for p in &poly {
                    out_p.extend_from_slice(&[p.x, p.y]);
                    out_uv.extend_from_slice(&[p.u, p.v]);
                }
                for k in 1..poly.len() as u32 - 1 {
                    out_t.extend_from_slice(&[base, base + k, base + k + 1]);
                }
            }
        }
    }
}
