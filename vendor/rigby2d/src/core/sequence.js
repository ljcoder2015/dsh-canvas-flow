// SPDX-License-Identifier: MIT OR Apache-2.0
// Image sequences: an attachment that shows one of several numbered images ("flame01",
// "flame02", ...). Sequence keys pick the frame: hold a frame, or play forward, backward, looping
// or ping-ponging from a frame at a fixed delay per frame.

/** Name of frame `index` (0-based) of a sequence attachment. */
export function sequenceFrameName(att, index) {
  const s = att.sequence;
  const start = s.start ?? 1;
  const digits = s.digits ?? 0;
  const count = Math.max(1, s.count ?? 1);
  const i = Math.min(count - 1, Math.max(0, index | 0));
  return `${att.image ?? att.name}${String(start + i).padStart(digits, '0')}`;
}

/** Frame shown when no key sets one. */
export function sequenceSetupIndex(att) {
  return att.sequence?.setup ?? 0;
}

/**
 * Frame for sequence keys at `time`. Keys are { time, mode, index, delay } with mode one of hold,
 * once, loop, pingpong and their Reverse variants (frames counted from the last one); a key
 * without a delay keeps the previous key's. Returns null before the first key.
 */
export function sequenceIndexAt(keys, time, count) {
  let k = -1;
  let delay = 0;
  for (let i = 0; i < keys.length && (keys[i].time ?? 0) <= time; i++) {
    k = i;
    delay = keys[i].delay ?? delay;
  }
  if (k < 0) return null;
  const key = keys[k];
  const mode = key.mode ?? 'hold';
  const index = key.index ?? 0;
  if (mode === 'hold' || count <= 1) return Math.min(count - 1, Math.max(0, index));
  const steps = delay > 0 ? Math.floor((time - (key.time ?? 0)) / delay + 1e-6) : 0;
  const reverse = mode.endsWith('Reverse');
  const base = mode.replace('Reverse', '');
  let f = index + steps;
  if (base === 'once') f = Math.min(f, count - 1);
  else if (base === 'loop') f %= count;
  else if (base === 'pingpong') {
    const period = 2 * (count - 1);
    f %= period;
    if (f >= count) f = period - f;
  }
  return reverse ? count - 1 - f : f;
}
