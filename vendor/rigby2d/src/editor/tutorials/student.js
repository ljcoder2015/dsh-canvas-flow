// SPDX-License-Identifier: MIT OR Apache-2.0
// The arena's student: does each tutorial step the way a person would, with real clicks, wheel
// turns and pointer drags on the anchored controls, so the arena tests what users actually do.

import { anchor } from './targets.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Redraws the editor, then lets the coach notice. */
export async function settle(ctx, ms = 60) {
  ctx.refresh?.();
  await sleep(ms);
  ctx.refresh?.();
}

function need(id) {
  const el = anchor(id);
  if (!el) throw new Error(`student: '${id}' is not on screen`);
  return el;
}

export async function click(ctx, id) {
  need(id).click();
  await settle(ctx);
}

/** Opens a menu and picks an item. */
export async function menu(ctx, title, item) {
  need(`menu:${title}`).click();
  await settle(ctx);
  need(`item:${item}`).click();
  await settle(ctx);
}

/** Picks an option of an anchored list by its label. */
export async function choose(ctx, id, label) {
  const el = need(id);
  const option = [...el.options].find((o) => o.textContent === label);
  if (!option) throw new Error(`student: '${id}' has no option '${label}'`);
  el.value = option.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(ctx);
}

export async function wheel(ctx, deltaY) {
  const canvas = ctx.viewport.canvas;
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
  await settle(ctx);
}

/** A pointer drag across the viewport between two screen points (button 0 left, 2 right). */
export async function drag(ctx, from, to, button = 0) {
  const canvas = ctx.viewport.canvas;
  const buttons = button === 2 ? 2 : 1;
  const ev = (type, [x, y], b) => canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, buttons: b, pointerId: 1, isPrimary: true, bubbles: true, cancelable: true }));
  ev('pointerdown', from, buttons);
  for (let i = 1; i <= 8; i++) ev('pointermove', [from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8], buttons);
  ev('pointerup', to, 0);
  await settle(ctx);
}

/** Screen position of a world point. */
export function screenOf(ctx, p) {
  const [x, y] = ctx.viewport.toScreen(p);
  const r = ctx.viewport.canvas.getBoundingClientRect();
  return [r.left + x, r.top + y];
}

/** A screen point in the viewport with nothing under it (and not under the coach panel). */
export function emptySpot(ctx) {
  const canvas = ctx.viewport.canvas;
  const r = canvas.getBoundingClientRect();
  const panel = document.querySelector('.coach')?.getBoundingClientRect();
  const pose = ctx.app.pose();
  for (const [fx, fy] of [[0.85, 0.2], [0.85, 0.5], [0.15, 0.2], [0.5, 0.15], [0.85, 0.8], [0.15, 0.8]]) {
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    if (panel && x > panel.left && x < panel.right && y > panel.top && y < panel.bottom) continue;
    if (!ctx.viewport.hitTest(pose, [x - r.left, y - r.top])) return [x, y];
  }
  throw new Error('student: no empty spot in the viewport');
}

/** Drags in empty viewport space: moves, rotates or scales the selection with the current tool. */
export async function dragEmpty(ctx, dx, dy) {
  const from = emptySpot(ctx);
  await drag(ctx, from, [from[0] + dx, from[1] + dy]);
}

/** The world box of a layer's image (a region attachment), for drawing bones over it. */
export function layerBox(ctx, slotName) {
  const slot = ctx.app.doc.slots.find((s) => s.name === slotName);
  const a = slot.attachments.find((x) => x.name === slot.attachment) ?? slot.attachments[0];
  const { x, y } = a.offset;
  const hw = (a.width * Math.abs(a.offset.scale_x ?? 1)) / 2;
  const hh = (a.height * Math.abs(a.offset.scale_y ?? 1)) / 2;
  return { x, y, hw, hh };
}
