import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addConstraint, addIk, listConstraints, moveConstraint, removeConstraint, renameBoneRefs, renameConstraint } from '../src/core/constraintdata.js';
import { VERSION_FIELD as V, readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';

const rig = () =>
  readSkeletonJson({
    skeleton: { [V]: '4.3.0' },
    bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 10 }, { name: 'b', parent: 'a', x: 10 }, { name: 'c', parent: 'root', x: 50 }],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: { idle: { bones: { a: { rotate: [{ value: 0 }] } } } },
  }).skeleton;

test('constraints keep one application order across IK and the other types', () => {
  const sk = rig();
  addIk(sk, { name: 'leg', bones: [1, 2], target: 3 });
  addConstraint(sk, { type: 'transform', name: 'follow', bones: ['b'], source: 'c' });
  addConstraint(sk, { type: 'physics', name: 'wobble', bone: 'b', rotate: 1 });
  assert.deepEqual(listConstraints(sk).map((c) => c.name), ['leg', 'follow', 'wobble']);
  moveConstraint(sk, 'wobble', -1);
  assert.deepEqual(listConstraints(sk).map((c) => c.name), ['leg', 'wobble', 'follow']);
  const out = writeSkeletonJson(sk, { version: '4.3' }).json;
  assert.deepEqual(out.constraints.map((c) => c.name), ['leg', 'wobble', 'follow']);
});

test('renames follow bones and constraints; deleting a bone removes constraints that need it', () => {
  const sk = rig();
  addConstraint(sk, { type: 'transform', name: 'follow', bones: ['b'], source: 'c' });
  sk.animations[0].extra.transform = { follow: [{ mixRotate: 0.5 }] };
  renameBoneRefs(sk, 'c', 'driver');
  sk.bones[3].name = 'driver';
  assert.equal(listConstraints(sk)[0].data.source, 'driver');
  renameConstraint(sk, 'follow', 'chase');
  assert.ok(sk.animations[0].extra.transform.chase);
  sk.removeBone(3);
  assert.equal(listConstraints(sk).length, 0);
  assert.equal(sk.animations[0].extra.transform.chase, undefined);
  addIk(sk, { name: 'x', bones: [1], target: 2 });
  assert.ok(removeConstraint(sk, 'x'));
  assert.equal(sk.ik.length, 0);
});

test('new constraints export to older formats in their layout', () => {
  const sk = rig();
  addConstraint(sk, { type: 'transform', name: 'follow', bones: ['b'], source: 'c', rotation: 15, mixX: 0.5, properties: { rotate: { to: { rotate: {} } }, x: { to: { x: {} } } } });
  addConstraint(sk, { type: 'slider', name: 's', animation: 'idle' });
  const { json, warnings } = writeSkeletonJson(sk, { version: '4.2' });
  assert.deepEqual(json.transform[0], { order: 0, name: 'follow', bones: ['b'], target: 'c', rotation: 15, mixRotate: 1, mixX: 0.5, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 });
  assert.ok(warnings.some((w) => w.includes('slider')));
  const back = readSkeletonJson(json).skeleton;
  assert.equal(listConstraints(back).length, 1);
});

test('constraint keys: set, update and ease curves in the stored layout', async () => {
  const { setConstraintKey, setConstraintCurve, channelKeys } = await import('../src/core/constraintkeys.js');
  const { sampleRaw } = await import('../src/core/constraints.js');
  const sk = rig();
  const anim = sk.animations[0];
  setConstraintKey(anim, 'path', 'p', 'position', 0.5, { value: 1 });
  setConstraintKey(anim, 'path', 'p', 'position', 0, { value: 0 });
  setConstraintKey(anim, 'path', 'p', 'position', 0.5, { value: 2 }); // updates
  const keys = channelKeys(anim, 'path', 'p', 'position');
  assert.deepEqual(keys.map((k) => [k.time, k.value]), [[0, 0], [0.5, 2]]);
  assert.equal(sampleRaw(keys, 0.25, (k) => [k.value])[0], 1);
  setConstraintCurve(keys, 0, ['value'], { value: 0 }, { bezier: [0.42, 0, 0.58, 1] });
  assert.ok(Math.abs(sampleRaw(keys, 0.25, (k) => [k.value])[0] - 1) < 1e-3, 'symmetric ease passes the midpoint');
  assert.ok(sampleRaw(keys, 0.1, (k) => [k.value])[0] < 0.4, 'eases in');
  setConstraintCurve(keys, 0, ['value'], { value: 0 }, 'stepped');
  assert.equal(sampleRaw(keys, 0.4, (k) => [k.value])[0], 0);
});
