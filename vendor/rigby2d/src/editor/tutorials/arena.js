// SPDX-License-Identifier: MIT OR Apache-2.0
// The tutorial arena: plays every lesson in the real editor as a student would and checks each
// step. A lesson passes only when, at every step:
// - its target is on screen and the ring sits exactly on it (within 2 px);
// - the coach panel does not cover the target;
// - an action step moves on by itself once the student has done it (no Next button needed);
// - an explanation step moves on with Next.
// Run it in a development build: window.rigby.tutorials.arena().

import { lintLesson } from './lint.js';
import { settle } from './student.js';
import { overlaps } from './targets.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits until `test()` is true (refreshing the editor meanwhile), up to `ms`. */
async function until(ctx, test, ms = 2500) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (test()) return true;
    ctx.refresh?.();
    await sleep(60);
  }
  return test();
}

/** Checks the ring and the panel against the current step's target. Returns problems. */
function checkPlacement(coach) {
  const problems = [];
  if (!coach.step?.target) return problems;
  const t = coach.target();
  if (!t) return ['the target is not on screen'];
  coach.place();
  const ring = coach.ring.getBoundingClientRect();
  const pad = t.kind === 'area' ? 0 : 4;
  const off = Math.max(Math.abs(ring.left + pad - t.box.left), Math.abs(ring.top + pad - t.box.top), Math.abs(ring.width - pad * 2 - t.box.width), Math.abs(ring.height - pad * 2 - t.box.height));
  if (coach.ring.hidden) problems.push('the ring is hidden');
  else if (off > 2) problems.push(`the ring is ${off.toFixed(0)} px off its target`);
  const inPanel = t.el && coach.panel.contains(t.el);
  if (t.kind !== 'area' && !inPanel && overlaps(coach.panel.getBoundingClientRect(), t.box)) problems.push('the panel covers the target');
  return problems;
}

/**
 * Plays `lessons` with `coach`. `refresh()` redraws the editor's panels at once. Returns
 * { ok, lessons: [{ id, ok, steps: [{ step, ok, problems }] }] }.
 */
export async function runArena(coach, lessons, { refresh = () => {}, prepare = async () => {} } = {}) {
  const results = [];
  for (const lesson of lessons) {
    const lint = lintLesson(lesson);
    const steps = [];
    if (lint.length) {
      results.push({ id: lesson.id, ok: false, steps: [{ step: 0, ok: false, problems: lint }] });
      continue;
    }
    await prepare(lesson);
    coach.start(lesson);
    const ctx = { ...coach.ctx, refresh };
    for (let i = 0; i < lesson.steps.length && coach.running; i++) {
      await settle(ctx, 120);
      if (coach.index !== i) {
        // Already done when it started (e.g. already in Setup mode): that is allowed.
        steps.push({ step: i + 1, ok: true, problems: [], note: 'done on arrival' });
        i = coach.index - 1;
        continue;
      }
      const step = lesson.steps[i];
      const problems = checkPlacement(coach);
      if (step.next) {
        const next = document.querySelector('[data-tut="coach:next"]');
        if (!next) problems.push('an explanation step without a Next button');
        else next.click();
        if (!(await until(ctx, () => coach.index !== i || !coach.running, 800))) problems.push('Next did not move on');
      } else {
        if (document.querySelector('[data-tut="coach:next"]')) problems.push('an action step shows Next');
        try {
          await step.student({ ...coach.ctx, refresh });
        } catch (e) {
          problems.push(`the student could not do it: ${e.message}`);
        }
        if (!(await until(ctx, () => coach.index !== i || !coach.running))) {
          problems.push('did not move on by itself after the step was done');
          // Keep going so the rest of the lesson is still checked.
          document.querySelector('[data-tut="coach:skip"]')?.click();
        }
      }
      steps.push({ step: i + 1, ok: problems.length === 0, problems });
    }
    if (coach.running) coach.stop();
    // Close anything a lesson left open (menus, dialogs).
    document.querySelectorAll('.modal-backdrop, .popup').forEach((e) => e.remove());
    results.push({ id: lesson.id, ok: steps.every((s) => s.ok), steps });
  }
  return { ok: results.every((r) => r.ok), lessons: results };
}
