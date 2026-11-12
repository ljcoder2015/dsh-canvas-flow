// SPDX-License-Identifier: MIT OR Apache-2.0
// Example player: loads a skeleton (.json or .skel), its .atlas and page images, and plays it with
// the runtime and the reference WebGL renderer. Run `npm run web:dev` and open /examples/webgl.html.

import { parseAtlas } from '../src/core/atlas.js';
import { isSkeletonBinary, readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { WebGLRenderer } from '../src/webgl/renderer.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#view');
const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false }) ?? canvas.getContext('webgl', { premultipliedAlpha: true, alpha: false });
const renderer = new WebGLRenderer(gl);
const state = new AnimationState();
let sk = null;
let pose = null;
let textures = null;
let camera = { x: 0, y: 0, zoom: 1 };
const events = [];

state.addListener({ event: (entry, e) => events.push({ text: `${e.name} (track ${entry.track})`, at: performance.now() }) });

/** Loads a skeleton from files: { name: File }. Exposed for scripted use. */
export async function load(files) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const skelFile = files.find((f) => /\.(json|skel)$/i.test(f.name));
  const atlasFile = files.find((f) => /\.atlas(\.txt)?$/i.test(f.name));
  if (!skelFile || !atlasFile) throw new Error('choose a .json or .skel file, its .atlas and the atlas page images');
  const bytes = new Uint8Array(await skelFile.arrayBuffer());
  const json = isSkeletonBinary(bytes) ? readSkeletonBinary(bytes) : JSON.parse(new TextDecoder().decode(bytes));
  sk = readSkeletonJson(json, skelFile.name).skeleton;
  const atlas = parseAtlas(await atlasFile.text());
  const pages = new Map();
  for (const page of atlas.pages) {
    const file = byName.get(page.name);
    if (file) pages.set(page.name, await createImageBitmap(file, { premultiplyAlpha: 'none' }));
  }
  textures = renderer.atlasTextures(atlas, pages);
  pose = new Pose(sk);
  fillSelect($('#anim'), sk.animations.map((a) => a.name));
  fillSelect($('#anim2'), sk.animations.map((a) => a.name));
  fillSelect($('#skin'), ['default', ...sk.skins.map((s) => s.name)]);
  sk.skin = sk.skins[0]?.name ?? null;
  $('#skin').value = sk.skin ?? 'default';
  state.stop();
  if (sk.animations.length) state.play(sk, sk.animations[0].name, true, 0);
  fit();
}

function fillSelect(el, names) {
  el.replaceChildren(...names.map((n) => Object.assign(document.createElement('option'), { value: n, textContent: n })));
}

/** Frames the setup pose bounds. */
function fit() {
  pose.setToSetup(sk);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const q of pose.quads(sk)) {
    for (const [x, y] of q.positions) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: 0.85 * Math.min(w / (x1 - x0), h / (y1 - y0)) };
}

$('#files').addEventListener('change', (e) => load([...e.target.files]).catch((err) => ($('#stats').textContent = err.message)));
$('#anim').addEventListener('change', (e) => sk && state.setAnimation(sk, 0, e.target.value, true, 0.2));
$('#skin').addEventListener('change', (e) => {
  if (!sk) return;
  sk.skin = e.target.value === 'default' ? null : e.target.value;
  fit();
});
const syncLayer = () => {
  if (!sk) return;
  if ($('#layer').checked) state.setAnimation(sk, 1, $('#anim2').value, true, 0.2);
  else state.clearTrack(1);
};
$('#layer').addEventListener('change', syncLayer);
$('#anim2').addEventListener('change', syncLayer);

let last = performance.now();
let frameTimes = [];
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.16, 0.16, 0.16, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (sk) {
    const t0 = performance.now();
    state.update(sk, dt);
    state.apply(sk, pose);
    renderer.begin(w, h, { ...camera, zoom: camera.zoom * dpr });
    renderer.drawSkeleton(sk, pose, textures);
    renderer.end();
    frameTimes.push(performance.now() - t0);
    if (frameTimes.length > 60) frameTimes.shift();
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    const recent = events.filter((e) => now - e.at < 1000).map((e) => e.text);
    $('#stats').textContent = `${avg.toFixed(2)} ms/frame · ${renderer.drawCalls} draw calls${recent.length ? ` · ⚑ ${recent.join(', ')}` : ''}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.rigbyPlayer = { load, fit, state, renderer, get skeleton() { return sk; }, get textures() { return textures; } };
