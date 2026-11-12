// SPDX-License-Identifier: MIT OR Apache-2.0
// Golden data for the Rust runtime: plays skeletons with the JavaScript runtime (src/core) through
// fixed scenarios and records bone world matrices, drawables, draw order and events per frame.
// Usage: node generate.mjs <out.golden.json> <skeleton file (.json or .skel)> [label]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const core = (p) => import(pathToFileURL(path.join(repo, 'src/core', p)).href);
const { readSkeletonJson } = await core('interop.js');
const { isSkeletonBinary, readSkeletonBinary } = await core('binary.js');
const { Pose } = await core('pose.js');
const { AnimationState } = await core('state.js');

const [out, file, label] = process.argv.slice(2);
const bytes = new Uint8Array(fs.readFileSync(file));
const obj = isSkeletonBinary(bytes) ? readSkeletonBinary(bytes) : JSON.parse(new TextDecoder().decode(bytes));
const sk = readSkeletonJson(obj, 'x').skeleton;
const DT = 1 / 30;

function frame(pose, events) {
  return {
    world: pose.world.flatMap((m) => [m.a, m.b, m.c, m.d, m.tx, m.ty]),
    drawOrder: [...pose.drawOrder],
    quads: pose.quads(sk).map((q) => ({ slot: q.slot, image: q.image, positions: q.positions.flat(), color: q.color.slice(0, 4) })),
    events: events.splice(0),
  };
}

function run(kind, setup, steps, every, skin = null) {
  sk.skin = skin;
  const pose = new Pose(sk);
  const state = new AnimationState();
  const events = [];
  state.addListener({ event: (e, ev) => events.push(`${e.track}:${ev.name}@${ev.time}`), complete: (e) => events.push(`${e.track}:complete:${e.name}`) });
  const frames = [];
  setup(state, 0);
  for (let i = 1; i <= steps; i++) {
    setup(state, i);
    state.update(sk, DT);
    state.apply(sk, pose);
    if (i % every === 0) frames.push(frame(pose, events));
  }
  sk.skin = null;
  return { kind, skin, frames };
}

const anims = sk.animations;
const scenarios = [];
scenarios.push(run('setup', () => {}, 1, 1));
for (const a of anims) {
  const steps = Math.max(10, Math.min(75, Math.ceil((a.duration + 0.4) / DT)));
  scenarios.push({ animation: a.name, ...run('loop', (s, i) => i === 0 && s.setAnimation(sk, 0, a.name, true, 0), steps, 3) });
}
if (anims.length >= 2) {
  const [a, b] = [anims[0].name, anims[1].name];
  const top = anims[anims.length - 1].name;
  scenarios.push({
    animation: `${a}>${b}+${top}`,
    ...run(
      'mix',
      (s, i) => {
        if (i === 0) s.setAnimation(sk, 0, a, true, 0);
        if (i === 12) {
          s.setAnimation(sk, 0, b, true, 0.25);
          const e = s.setAnimation(sk, 1, top, false, 0);
          if (e) e.alpha = 0.5;
          s.addAnimation(sk, 0, a, true, 0.2, 0.5);
        }
      },
      45,
      2,
    ),
  });
}
for (const skin of sk.skins.slice(0, 2)) {
  if (!anims.length) break;
  scenarios.push({ animation: anims[0].name, ...run('skin', (s, i) => i === 0 && s.setAnimation(sk, 0, anims[0].name, true, 0), 20, 5, skin.name) });
}
const rel = path.relative(repo, path.resolve(file)).split(path.sep).join('/');
fs.writeFileSync(out, JSON.stringify({ label: label ?? rel, file: rel, bones: sk.bones.map((b) => b.name), images: null, scenarios }));
console.log(`${out}: ${scenarios.length} scenarios, ${scenarios.reduce((n, s) => n + s.frames.length, 0)} frames`);
