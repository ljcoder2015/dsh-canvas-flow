// SPDX-License-Identifier: MIT OR Apache-2.0
// Playback: tracks of animations layered on top of each other, crossfades, queued animations and
// event firing.
//
// Track 0 is the base layer; higher tracks are applied over it and only change what their
// animations key (for example an upper-body "shoot" over a "walk"). Each track plays one entry
// at a time, crossfading from the previous one, and can have more entries queued.

/**
 * A playing animation on a track. `alpha` scales the track's influence (layers), `timeScale`
 * its speed. `delay` (queued entries) is seconds after the previous entry started, or null to
 * start when the previous one ends.
 */
class TrackEntry {
  constructor(track, animation, name, looping, mix, delay) {
    this.track = track;
    this.animation = animation;
    this.name = name;
    this.looping = looping;
    this.mixDuration = mix;
    this.mixTime = 0;
    this.delay = delay;
    this.time = 0;
    /** Time before the last update, for event firing (negative so time-0 events fire). */
    this.lastTime = -1;
    /** True until the first update, so events at time 0 fire once. */
    this.fresh = true;
    this.alpha = 1;
    this.timeScale = 1;
    /** The entry being faded out. */
    this.previous = null;
    this.queue = [];
  }

  /** Mix progress in [0, 1]: how much this entry has replaced the previous one. */
  mix() {
    return this.mixDuration > 0 ? Math.min(1, this.mixTime / this.mixDuration) : 1;
  }
}

/** Plays animations on a skeleton: tracks, crossfades, queues and events. */
export class AnimationState {
  constructor() {
    /** Track entries by track index (holes are empty tracks). */
    this.tracks = [];
    /** Playback speed multiplier for every track. */
    this.speed = 1;
    this.listeners = [];
    /** Seconds since the last `apply`, simulated by physics constraints then. */
    this.physicsDelta = 0;
  }

  /**
   * Listens for playback callbacks. A listener may have any of: `start(entry)`, `end(entry)`
   * (replaced or cleared), `complete(entry)` (reached its end; every loop for looping entries)
   * and `event(entry, event)` where event is { name, time, int, float, string, audio, volume,
   * balance }. Returns a function that removes the listener.
   */
  addListener(listener) {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  notify(kind, entry, event) {
    for (const l of this.listeners) l[kind]?.(entry, event);
  }

  /** Base track: starts `name`, crossfading over `mix` seconds. Returns false if not found. */
  play(sk, name, looping, mix = 0) {
    return this.setAnimation(sk, 0, name, looping, mix) !== null;
  }

  /**
   * Starts `name` on `track` now, crossfading from what it played over `mix` seconds and
   * dropping anything queued. Returns the entry, or null if no animation has that name.
   */
  setAnimation(sk, track, name, looping, mix = 0) {
    const animation = sk.animations.findIndex((a) => a.name === name);
    if (animation < 0) return null;
    const entry = new TrackEntry(track, animation, name, looping, mix, null);
    const current = this.tracks[track];
    if (current) {
      for (const q of current.queue) this.notify('end', q);
      current.queue = [];
      this.replace(current, entry);
    } else {
      this.tracks[track] = entry;
      this.notify('start', entry);
    }
    return entry;
  }

  /**
   * Queues `name` on `track` after the current entry (or the last queued one): when it ends,
   * or `delay` seconds after it starts. Starts right away on an empty track.
   */
  addAnimation(sk, track, name, looping, mix = 0, delay = null) {
    const current = this.tracks[track];
    if (!current) return this.setAnimation(sk, track, name, looping, mix);
    const animation = sk.animations.findIndex((a) => a.name === name);
    if (animation < 0) return null;
    const entry = new TrackEntry(track, animation, name, looping, mix, delay);
    current.queue.push(entry);
    return entry;
  }

  /** Stops a track (its animation stops affecting the pose). */
  clearTrack(track) {
    const current = this.tracks[track];
    if (!current) return;
    for (const e of [current.previous, current, ...current.queue]) if (e) this.notify('end', e);
    this.tracks[track] = undefined;
  }

  stop() {
    this.tracks.forEach((_, i) => this.clearTrack(i));
    this.tracks = [];
  }

  /** The base track's entry (kept for simple use: `state.current.time`). */
  get current() {
    return this.tracks[0] ?? null;
  }

  currentTime() {
    return this.current ? this.current.time : null;
  }

  replace(from, to) {
    // A fade that has not finished keeps fading out from the newest pose.
    if (from.previous) this.notify('end', from.previous);
    from.previous = null;
    to.previous = to.mixDuration > 0 ? from : null;
    if (!to.previous) this.notify('end', from);
    this.tracks[to.track] = to;
    this.notify('start', to);
  }

  /** Advances time by `dt` seconds, starting queued entries and firing events. */
  update(sk, dt) {
    // Older signature: update(dt).
    if (typeof sk === 'number') [sk, dt] = [null, sk];
    dt *= this.speed;
    this.physicsDelta += dt;
    for (const entry of [...this.tracks]) {
      if (!entry) continue;
      this.advance(sk, entry, dt);
      // Start the next queued entry once its time comes.
      const next = entry.queue[0];
      if (next && sk) {
        const anim = sk.animations[entry.animation];
        const start = next.delay ?? Math.max(0, (anim?.duration ?? 0) - next.mixDuration);
        if (entry.time >= start) {
          entry.queue.shift();
          next.queue = entry.queue;
          entry.queue = [];
          // Carry over the time past the switch point.
          next.time = Math.max(0, entry.time - start);
          next.mixTime = next.time;
          next.lastTime = -1;
          next.fresh = false;
          this.replace(entry, next);
          this.fireEvents(sk, next);
        }
      }
    }
  }

  advance(sk, entry, dt) {
    const step = dt * entry.timeScale;
    entry.lastTime = entry.fresh ? -1 : entry.time;
    entry.fresh = false;
    entry.time += step;
    entry.mixTime += step;
    if (sk) this.fireEvents(sk, entry);
    if (entry.previous) {
      // The entry fading out keeps playing, firing its events, until the mix ends.
      entry.previous.lastTime = entry.previous.time;
      entry.previous.time += dt * entry.previous.timeScale;
      if (sk) this.fireEvents(sk, entry.previous);
      if (entry.mixTime >= entry.mixDuration) {
        this.notify('end', entry.previous);
        entry.previous = null;
      }
    }
  }

  /** Fires the events and completions between an entry's last and current time. */
  fireEvents(sk, entry) {
    const anim = sk.animations[entry.animation];
    if (!anim) return;
    const d = anim.duration;
    const from = entry.lastTime;
    const to = entry.time;
    if (to < from) return;
    const fire = (t0, t1, loop) => {
      for (const e of anim.events) {
        if (e.time > t0 && e.time <= t1) this.notify('event', entry, eventData(sk, e, loop));
      }
    };
    if (!entry.looping || d <= 0) {
      fire(from, Math.min(to, d), 0);
      if (from < d && to >= d) this.notify('complete', entry);
      return;
    }
    // Looping: fire per loop crossed.
    const startLoop = Math.floor(Math.max(from, 0) / d);
    const endLoop = Math.floor(to / d);
    for (let loop = startLoop; loop <= endLoop; loop++) {
      const t0 = loop === startLoop ? from - loop * d : -1;
      const t1 = loop === endLoop ? to - loop * d : d;
      fire(t0, t1, loop);
      if (loop < endLoop) this.notify('complete', entry);
    }
  }

  /** Resets `pose` to setup, applies every track in order and updates world transforms. */
  apply(sk, pose) {
    pose.reset(sk);
    pose.physicsDelta = this.physicsDelta;
    this.physicsDelta = 0;
    for (const entry of this.tracks) {
      if (!entry) continue;
      const layer = entry.track === 0 ? 1 : entry.alpha;
      if (entry.previous) applyEntry(sk, pose, entry.previous, layer * entry.previous.alpha);
      applyEntry(sk, pose, entry, (entry.previous ? entry.mix() : 1) * (entry.track === 0 ? entry.alpha : layer));
    }
    pose.updateWorld(sk);
  }
}

/** An event key merged with its definition (keys override the definition's values). */
function eventData(sk, key, loop) {
  const def = sk.events.find((e) => e.name === key.name) ?? {};
  return {
    name: key.name,
    time: key.time,
    loop,
    int: key.int ?? def.int ?? 0,
    float: key.float ?? def.float ?? 0,
    string: key.string ?? def.string ?? null,
    audio: def.audio ?? null,
    volume: key.volume ?? def.volume ?? 1,
    balance: key.balance ?? def.balance ?? 0,
  };
}

export function remEuclid(a, b) {
  return ((a % b) + b) % b;
}

function applyEntry(sk, pose, entry, alpha) {
  const anim = sk.animations[entry.animation];
  if (!anim || alpha <= 0) return;
  const time = entry.looping && anim.duration > 0 ? remEuclid(entry.time, anim.duration) : Math.min(entry.time, anim.duration);
  pose.apply(sk, anim, time, Math.min(1, alpha));
}
