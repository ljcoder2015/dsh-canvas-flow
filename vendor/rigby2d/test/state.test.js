import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VERSION_FIELD as V, readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// Hand-written fixture: a two-bone rig with a walk (rotates `leg`), an upper-body wave (rotates
// `arm`) and events.
const rig = () =>
  readSkeletonJson({
    skeleton: { [V]: '4.2.0' },
    bones: [{ name: 'root' }, { name: 'leg', parent: 'root' }, { name: 'arm', parent: 'root' }],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    events: { step: { int: 1 }, wave: { string: 'hi' } },
    animations: {
      walk: {
        bones: { leg: { rotate: [{ value: 0 }, { time: 1, value: 40 }] } },
        events: [{ name: 'step' }, { time: 0.5, name: 'step', int: 2 }],
      },
      wave: {
        bones: { arm: { rotate: [{ value: 90 }, { time: 1, value: 90 }] } },
        events: [{ time: 0.25, name: 'wave' }],
      },
      jump: { bones: { leg: { rotate: [{ value: -20 }, { time: 0.5, value: -20 }] } } },
    },
  }).skeleton;

function recorder(state) {
  const log = [];
  state.addListener({
    start: (e) => log.push(`start ${e.name}`),
    end: (e) => log.push(`end ${e.name}`),
    complete: (e) => log.push(`complete ${e.name}`),
    event: (e, ev) => log.push(`event ${ev.name} ${ev.int}${ev.string ? ` ${ev.string}` : ''} @${ev.time}`),
  });
  return log;
}

test('events fire once per crossing, including time 0 and every loop', () => {
  const sk = rig();
  const state = new AnimationState();
  const log = recorder(state);
  state.play(sk, 'walk', true);
  for (let i = 0; i < 25; i++) state.update(sk, 0.1); // 2.5 s: 2.5 loops
  const events = log.filter((l) => l.startsWith('event'));
  assert.deepEqual(events, ['event step 1 @0', 'event step 2 @0.5', 'event step 1 @0', 'event step 2 @0.5', 'event step 1 @0', 'event step 2 @0.5']);
  assert.equal(log.filter((l) => l === 'complete walk').length, 2);
});

test('a big time step fires every event it skips over', () => {
  const sk = rig();
  const state = new AnimationState();
  const log = recorder(state);
  state.play(sk, 'walk', true);
  state.update(sk, 2.2);
  assert.equal(log.filter((l) => l.startsWith('event')).length, 5);
});

test('layered track only changes what its animation keys', () => {
  const sk = rig();
  const state = new AnimationState();
  state.play(sk, 'walk', true);
  state.setAnimation(sk, 1, 'wave', true);
  state.update(sk, 0.5);
  const pose = new Pose(sk);
  state.apply(sk, pose);
  assert.ok(close(pose.local[1].rotation, 20));
  assert.ok(close(pose.local[2].rotation, 90));

  // Half-weight layer.
  state.tracks[1].alpha = 0.5;
  state.apply(sk, pose);
  assert.ok(close(pose.local[2].rotation, 45));
  assert.ok(close(pose.local[1].rotation, 20));

  state.clearTrack(1);
  state.apply(sk, pose);
  assert.ok(close(pose.local[2].rotation, 0));
});

test('queued animation starts when the current one ends, crossfading', () => {
  const sk = rig();
  const state = new AnimationState();
  const log = recorder(state);
  state.play(sk, 'jump', false);
  state.addAnimation(sk, 0, 'walk', true, 0.2);
  state.update(sk, 0.2);
  assert.equal(state.current.name, 'jump');
  state.update(sk, 0.2); // 0.4: walk starts at 0.5 - 0.2 = 0.3
  assert.equal(state.current.name, 'walk');
  assert.ok(close(state.current.time, 0.1));
  assert.ok(state.current.previous);
  const pose = new Pose(sk);
  state.apply(sk, pose);
  // Half way through the 0.2 s mix: between jump (-20) and walk at 0.1 s (4).
  assert.ok(close(pose.local[1].rotation, -20 + (4 + 20) * 0.5), String(pose.local[1].rotation));
  state.update(sk, 0.2);
  assert.equal(state.current.previous, null);
  assert.deepEqual(
    log.filter((l) => !l.startsWith('event')),
    ['start jump', 'start walk', 'complete jump', 'end jump'],
  );
});

test('old single-track API still works', () => {
  const sk = rig();
  const state = new AnimationState();
  assert.equal(state.play(sk, 'missing', true, 0), false);
  assert.equal(state.play(sk, 'walk', true, 0), true);
  state.update(0.25);
  const pose = new Pose(sk);
  state.apply(sk, pose);
  assert.ok(close(state.currentTime(), 0.25));
  assert.ok(close(pose.local[1].rotation, 10));
});
