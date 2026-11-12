// SPDX-License-Identifier: MIT OR Apache-2.0
// Clipping attachments: a polygon that masks the slots drawn after it (up to its end slot).
// The polygon is split into triangles (it may be concave) and each drawn triangle is clipped
// against each of them, interpolating UVs.

/** Signed area of a flat [x, y, ...] polygon (positive when counter-clockwise, Y up). */
function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += p[i] * p[j + 1] - p[j] * p[i + 1];
  }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon; returns counter-clockwise triangles. */
export function triangulate(polygon) {
  let p = polygon.slice();
  if (signedArea(p) < 0) {
    const r = [];
    for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
    p = r;
  }
  const idx = [];
  for (let i = 0; i < p.length / 2; i++) idx.push(i);
  const x = (i) => p[2 * i];
  const y = (i) => p[2 * i + 1];
  const cross = (a, b, c) => (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a));
  const inside = (a, b, c, q) => cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0;
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length];
      const b = idx[k];
      const c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 0) continue; // reflex or degenerate corner
      if (idx.some((q) => q !== a && q !== b && q !== c && inside(a, b, c, q))) continue;
      out.push([x(a), y(a), x(b), y(b), x(c), y(c)]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // self-intersecting input: keep what we have
  }
  if (idx.length === 3) out.push(idx.flatMap((i) => [x(i), y(i)]));
  return out;
}

/**
 * Clips a convex polygon of vertices [{x, y, u, v}] against a counter-clockwise convex triangle
 * (Sutherland-Hodgman). Returns the clipped polygon (possibly empty).
 */
function clipConvex(poly, tri) {
  let out = poly;
  for (let e = 0; e < 3 && out.length; e++) {
    const ax = tri[2 * e];
    const ay = tri[2 * e + 1];
    const bx = tri[(2 * e + 2) % 6];
    const by = tri[(2 * e + 3) % 6];
    const side = (p) => (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t });
      }
    }
  }
  return out;
}

/** An active clipping region: triangles of the clip polygon in world space. */
export class Clipper {
  /** @param {number[]} polygon world vertices [x, y, ...] */
  constructor(polygon) {
    this.triangles = triangulate(polygon);
  }

  /**
   * Clips a triangle mesh. `positions` and `uvs` are flat [x, y, ...] / [u, v, ...] arrays,
   * `triangles` vertex indices. Calls `emit(positions, uvs, triangles)` with the clipped mesh.
   */
  clip(positions, uvs, triangles, emit) {
    const outP = [];
    const outUv = [];
    const outT = [];
    const vertex = (i) => ({ x: positions[2 * i], y: positions[2 * i + 1], u: uvs[2 * i], v: uvs[2 * i + 1] });
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      let tri = [vertex(triangles[t]), vertex(triangles[t + 1]), vertex(triangles[t + 2])];
      // Work in counter-clockwise order so "inside" is on the left of every edge.
      const area = (tri[1].x - tri[0].x) * (tri[2].y - tri[0].y) - (tri[1].y - tri[0].y) * (tri[2].x - tri[0].x);
      if (area < 0) tri = [tri[0], tri[2], tri[1]];
      for (const clip of this.triangles) {
        const poly = clipConvex(tri, clip);
        if (poly.length < 3) continue;
        const base = outP.length / 2;
        for (const p of poly) {
          outP.push(p.x, p.y);
          outUv.push(p.u, p.v);
        }
        for (let k = 1; k + 1 < poly.length; k++) outT.push(base, base + k, base + k + 1);
      }
    }
    if (outT.length) emit(outP, outUv, outT);
  }
}
