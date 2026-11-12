// SPDX-License-Identifier: MIT OR Apache-2.0
// What a tutorial step points at, and where it is on screen. Controls carry fixed anchors
// (data-tut="tool:translate", "bone:head", "item:AutoRig artwork…"), so lessons never guess from
// visible text. Boxes are clipped to what is really visible (scrolled panels, the window).
//
// Target forms:
//   'tool:translate'          an anchor
//   ['item:Tutorials…', 'menu:Help']   the first anchor that is visible (an open menu's item, else its title)
//   { bone: 'ik_hand_r' }     a bone's base in the viewport
//   { area: 'viewport' }      a whole area the step works in (outlined, not ringed)

/** The element with anchor `id` that is on screen, or null. */
export function anchor(id) {
  for (const el of document.querySelectorAll(`[data-tut="${CSS.escape(id)}"]`)) if (el.getClientRects().length) return el;
  return null;
}

/** Rectangle intersection, or null when empty. */
function intersect(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return right - left >= 1 && bottom - top >= 1 ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}

/** The part of an element that is really visible: inside every scrolling ancestor and the window. */
export function visibleBox(el) {
  let box = el.getBoundingClientRect();
  box = intersect(box, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
  for (let p = el.parentElement; p && box; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(style.overflow + style.overflowX + style.overflowY)) box = intersect(box, p.getBoundingClientRect());
  }
  return box;
}

/**
 * Resolves a target to { kind: 'element' | 'spot' | 'area', el, box } (box: the visible screen
 * rectangle), or null when it is not on screen. `reveal` scrolls an element into view first.
 */
export function resolve(target, ctx, { reveal = false } = {}) {
  if (!target) return null;
  if (typeof target === 'object' && !Array.isArray(target)) {
    if (target.bone) {
      const { app, viewport } = ctx;
      const i = app.doc.bones.findIndex((b) => b.name === target.bone);
      if (i < 0 || !viewport) return null;
      const [x, y] = viewport.toScreen(app.pose().world[i].apply([0, 0]));
      const r = viewport.canvas.getBoundingClientRect();
      const box = intersect({ left: r.left + x - 22, top: r.top + y - 22, right: r.left + x + 22, bottom: r.top + y + 22 }, r);
      return box ? { kind: 'spot', el: null, box } : null;
    }
    if (target.area) {
      const el = anchor(target.area);
      const box = el && visibleBox(el);
      return box ? { kind: 'area', el, box } : null;
    }
    return null;
  }
  for (const id of Array.isArray(target) ? target : [target]) {
    const el = anchor(id);
    if (!el) continue;
    let box = visibleBox(el);
    const full = el.getBoundingClientRect();
    // Mostly hidden in a scrolled panel: bring it into view.
    if (reveal && (!box || box.width * box.height < full.width * full.height * 0.6)) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      box = visibleBox(el);
    }
    if (box) return { kind: 'element', el, box };
  }
  return null;
}

/** Whether two boxes overlap, with a margin. */
export function overlaps(a, b, margin = 0) {
  return a.left - margin < b.right && a.right + margin > b.left && a.top - margin < b.bottom && a.bottom + margin > b.top;
}
