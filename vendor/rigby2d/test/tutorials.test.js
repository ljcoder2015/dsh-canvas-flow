// SPDX-License-Identifier: MIT OR Apache-2.0
// The tutorials' practice character: Rigbytron as loose layers must stay rig-able by AutoRig, with
// the bones the lessons point at (head, ik_hand_r, ik_foot_l).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { autoRig } from '../src/core/autorig.js';
import { Skeleton } from '../src/core/model.js';
import { unzip } from '../src/editor/zip.js';
import { alphaOf, decodePng } from '../src/mcp/png.js';
import { looseLayers, PRACTICE_NAME } from '../src/editor/tutorials/practice.js';

test('tutorial practice character: loose layers that AutoRig rigs with the bones the lessons use', () => {
  const entries = unzip(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/rigbytron.rigby', import.meta.url))));
  const demo = Skeleton.fromJson(new TextDecoder().decode(entries.get('project.json')));
  const layers = looseLayers(demo);
  assert.equal(layers.name, PRACTICE_NAME);
  assert.equal(layers.bones.length, 1, 'nothing connected yet, like a PSD import');
  assert.ok(!layers.slots.some((s) => s.name === 'slash_fx'), 'effects are left out');
  const alpha = (name) => {
    const bytes = entries.get(`images/${name}.png`);
    return bytes ? alphaOf(decodePng(bytes)) : null;
  };
  const report = autoRig(layers, alpha);
  for (const name of ['head', 'hip', 'chest', 'ik_hand_r', 'ik_foot_l', 'ik_foot_r']) assert.ok(report.bones.includes(name), `bone ${name}`);
  // The right arm (upper arm, forearm, hand) is one chain on one side.
  const side = (n) => report.parts.find((p) => p.name === n)?.side;
  assert.deepEqual([side('upperarm'), side('forearm'), side('hand')], ['r', 'r', 'r']);
  assert.deepEqual(report.warnings, []);
});

test('tutorial lessons: every step is an action that moves on by itself, or an explanation with Next', async () => {
  const { LESSONS } = await import('../src/editor/tutorials/lessons.js');
  const { lintLesson } = await import('../src/editor/tutorials/lint.js');
  assert.ok(LESSONS.length >= 4);
  for (const lesson of LESSONS) assert.deepEqual(lintLesson(lesson), [], lesson.id);
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length, 'lesson ids are unique');
});
