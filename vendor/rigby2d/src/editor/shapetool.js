// SPDX-License-Identifier: MIT OR Apache-2.0
// Editing bounding boxes, clipping polygons and paths in the viewport (Setup mode). Vertices are
// edited in setup-pose world space and written back in the slot bone's space, or each bone's
// space for weighted shapes (new vertices take the weights of their neighbor).

import { Pose } from '../core/pose.js';
import { Mode } from './app.js';

const HIT = 7;

/** Shape vertices as world points with their weights (null when unweighted). */
export function shapeState(doc, slot, att) {
  const flat = new Pose(doc).worldVertices(doc, slot, att);
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  const weights = att.weights ? att.weights.map((v) => v.map((w) => ({ bone: w.bone, weight: w.weight }))) : null;
  return { points, weights };
}

/** Writes world points back into the shape. Paths also get their stored lengths. */
export function writeShape(doc, slot, att, state) {
  const pose = new Pose(doc);
  att.vertexCount = state.points.length;
  if (state.weights) {
    att.weights = state.points.map((p, i) =>
      state.weights[i].map(({ bone, weight }) => {
        const [x, y] = pose.world[bone].inverse().apply(p);
        return { bone, x, y, weight };
      }),
    );
    delete att.vertices;
  } else {
    const inv = pose.world[doc.slots[slot].bone].inverse();
    att.vertices = state.points.flatMap((p) => inv.apply(p));
    delete att.weights;
  }
  if (att.type === 'path') att.lengths = pathLengths(state.points.map((p) => pose.world[doc.slots[slot].bone].inverse().apply(p)));
  // Deform keys no longer match the vertices.
  for (const anim of doc.animations) anim.deform = anim.deform.filter((d) => !(d.slot === slot && d.attachment === att.name));
}

const cubic = (a, b, c, d, t) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Cumulative curve lengths, one per path point (the last closes the loop), like stored paths. */
export function pathLengths(v) {
  const n = Math.floor(v.length / 3);
  const out = [];
  let total = 0;
  for (let c = 0; c < n; c++) {
    const next = (c + 1) % n;
    const ctrl = [v[3 * c + 1], v[3 * c + 2], v[3 * next], v[3 * next + 1]];
    let prev = ctrl[0];
    for (let s = 1; s <= 20; s++) {
      const t = s / 20;
      const p = [0, 1].map((k) => cubic(ctrl[0][k], ctrl[1][k], ctrl[2][k], ctrl[3][k], t));
      total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      prev = p;
    }
    out.push(total);
  }
  return out;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 1e-12 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

/** Viewport tool for `app.shapeEdit = { slot, name, selected }`. */
export class ShapeTool {
  constructor(app, viewport) {
    this.app = app;
    this.viewport = viewport;
    this.drag = null;
  }

  target() {
    const app = this.app;
    const e = app.shapeEdit;
    if (!e || app.mode !== Mode.Setup) return null;
    const att = app.doc.attachment(e.slot, e.name);
    if (!att || !['boundingbox', 'clipping', 'path'].includes(att.type)) return null;
    return { slot: e.slot, att, edit: e };
  }

  get active() {
    return this.target() !== null;
  }

  hit(points, pos) {
    let best = -1;
    let bestD = HIT;
    points.forEach((p, i) => {
      const s = this.viewport.toScreen(p);
      const d = Math.hypot(s[0] - pos[0], s[1] - pos[1]);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  commit(t, state) {
    writeShape(this.app.doc, t.slot, t.att, state);
    this.app.changed();
  }

  down(pos, e) {
    const t = this.target();
    if (!t) return;
    const state = shapeState(this.app.doc, t.slot, t.att);
    const world = this.viewport.toWorld(pos);
    const i = this.hit(state.points, pos);
    if (i >= 0) {
      t.edit.selected = i;
      this.drag = { index: i, start: state, alt: e.altKey };
      this.app.changed();
      return;
    }
    if (t.att.type === 'path') this.insertPathPoint(t, state, world);
    else this.insertPolygonPoint(t, state, world);
  }

  /** Inserts a vertex into the polygon edge nearest to the click. */
  insertPolygonPoint(t, state, world) {
    const n = state.points.length;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = distToSegment(world, state.points[i], state.points[(i + 1) % n]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    state.points.splice(best + 1, 0, world);
    if (state.weights) state.weights.splice(best + 1, 0, state.weights[best].map((w) => ({ ...w })));
    t.edit.selected = best + 1;
    this.commit(t, state);
    this.drag = { index: best + 1, start: shapeState(this.app.doc, t.slot, t.att) };
  }

  /** Inserts a path point (with handles along its neighbors) after the nearest point. */
  insertPathPoint(t, state, world) {
    const n = Math.floor(state.points.length / 3);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(state.points[3 * k + 1][0] - world[0], state.points[3 * k + 1][1] - world[1]);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    // Insert after the nearest point, or before it when the click is on its incoming side.
    const prev = state.points[3 * Math.max(0, best - 1) + 1];
    const next = state.points[3 * Math.min(n - 1, best + 1) + 1];
    const after = Math.hypot(next[0] - world[0], next[1] - world[1]) <= Math.hypot(prev[0] - world[0], prev[1] - world[1]) || best === 0;
    const at = after ? best + 1 : best;
    const a = state.points[3 * Math.max(0, at - 1) + 1];
    const b = state.points[3 * Math.min(n - 1, at) + 1] ?? world;
    const dir = [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
    const triple = [[world[0] - dir[0], world[1] - dir[1]], world, [world[0] + dir[0], world[1] + dir[1]]];
    state.points.splice(3 * at, 0, ...triple);
    if (state.weights) {
      const w = state.weights[3 * Math.min(n - 1, best) + 1];
      state.weights.splice(3 * at, 0, ...triple.map(() => w.map((x) => ({ ...x }))));
    }
    t.edit.selected = 3 * at + 1;
    this.commit(t, state);
    this.drag = { index: 3 * at + 1, start: shapeState(this.app.doc, t.slot, t.att) };
  }

  move(pos) {
    const t = this.target();
    if (!t || !this.drag) return;
    const start = this.drag.start;
    const state = { points: start.points.map((p) => p.slice()), weights: start.weights };
    const world = this.viewport.toWorld(pos);
    const i = this.drag.index;
    const old = start.points[i];
    const d = [world[0] - old[0], world[1] - old[1]];
    if (t.att.type === 'path') {
      const role = i % 3; // 0 = in-handle, 1 = point, 2 = out-handle
      const base = i - role;
      if (role === 1) {
        for (let k = base; k < base + 3; k++) state.points[k] = [start.points[k][0] + d[0], start.points[k][1] + d[1]];
      } else {
        state.points[i] = world;
        if (!this.drag.alt) {
          // Mirror the opposite handle around the point, keeping its length.
          const p = start.points[base + 1];
          const o = base + (role === 0 ? 2 : 0);
          const len = Math.hypot(start.points[o][0] - p[0], start.points[o][1] - p[1]);
          const dir = [p[0] - world[0], p[1] - world[1]];
          const dl = Math.hypot(dir[0], dir[1]) || 1;
          state.points[o] = [p[0] + (dir[0] / dl) * len, p[1] + (dir[1] / dl) * len];
        }
      }
    } else {
      state.points[i] = world;
    }
    this.commit(t, state);
  }

  up() {
    this.drag = null;
  }

  deleteSelected() {
    const t = this.target();
    if (!t || t.edit.selected === null || t.edit.selected === undefined) return false;
    const state = shapeState(this.app.doc, t.slot, t.att);
    const i = t.edit.selected;
    if (t.att.type === 'path') {
      const base = i - (i % 3);
      if (state.points.length / 3 <= 2) {
        this.app.setStatus('A path needs at least 2 points');
        return true;
      }
      state.points.splice(base, 3);
      if (state.weights) state.weights.splice(base, 3);
    } else {
      if (state.points.length <= 3) {
        this.app.setStatus('A polygon needs at least 3 vertices');
        return true;
      }
      state.points.splice(i, 1);
      if (state.weights) state.weights.splice(i, 1);
    }
    t.edit.selected = null;
    this.commit(t, state);
    return true;
  }

  draw(ctx) {
    const t = this.target();
    if (!t) return;
    const pts = shapeState(this.app.doc, t.slot, t.att).points.map((p) => this.viewport.toScreen(p));
    ctx.save();
    if (t.att.type === 'path') {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      for (let k = 0; k + 2 < pts.length; k += 3) {
        ctx.beginPath();
        ctx.moveTo(pts[k][0], pts[k][1]);
        ctx.lineTo(pts[k + 1][0], pts[k + 1][1]);
        ctx.lineTo(pts[k + 2][0], pts[k + 2][1]);
        ctx.stroke();
      }
    }
    pts.forEach((p, i) => {
      const point = t.att.type !== 'path' || i % 3 === 1;
      ctx.beginPath();
      if (point) ctx.rect(p[0] - 4, p[1] - 4, 8, 8);
      else ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i === t.edit.selected ? 'white' : point ? 'rgb(255,170,40)' : 'rgb(120,200,255)';
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.stroke();
    });
    ctx.restore();
  }
}
