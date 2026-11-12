import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Skeleton } from '../src/core/model.js';
import { pack } from '../src/editor/pack.js';
import { robot } from '../src/editor/sample.js';

test('pack places without overlap', () => {
  const items = Array.from({ length: 19 }, (_, k) => ({ name: `i${k}`, width: 10 * (k + 1), height: 7 * (19 - k) }));
  const { width, height, regions } = pack(items);
  regions.forEach((a, i) => {
    assert.ok(a.x + a.width <= width && a.y + a.height <= height);
    for (const b of regions.slice(i + 1)) {
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!overlap, `${a.name} overlaps ${b.name}`);
    }
  });
});

test('sample is valid and roundtrips', () => {
  const names = new Set();
  const sk = robot({ insertRgba: (name) => names.add(name) });
  assert.equal(Skeleton.fromJson(sk.toJson()).toJson(), sk.toJson());
  assert.ok(sk.slots.every((s) => s.attachments.every((a) => names.has(a.image))));
  assert.deepEqual(sk.animations.map((a) => a.name), ['walk', 'idle']);
});

test('zip writes a valid stored archive', async () => {
  const { zip, crc32 } = await import('../src/editor/zip.js');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = zip([{ path: 'a/b.txt', bytes: new TextEncoder().encode('hi') }]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 1);
});

test('unzip reads what zip writes', async () => {
  const { zip, unzip } = await import('../src/editor/zip.js');
  const enc = new TextEncoder();
  const files = unzip(zip([{ path: 'project.json', bytes: enc.encode('{"a":1}') }, { path: 'images/a b/c.png', bytes: new Uint8Array([1, 2, 3]) }]));
  assert.deepEqual([...files.keys()], ['project.json', 'images/a b/c.png']);
  assert.equal(new TextDecoder().decode(files.get('project.json')), '{"a":1}');
  assert.deepEqual([...files.get('images/a b/c.png')], [1, 2, 3]);
});
