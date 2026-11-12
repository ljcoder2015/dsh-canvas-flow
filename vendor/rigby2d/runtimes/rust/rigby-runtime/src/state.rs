// SPDX-License-Identifier: MIT OR Apache-2.0
//! Playback: tracks of animations layered on top of each other, crossfades, queued animations and
//! events. Track 0 is the base layer; higher tracks apply over it and only change what their
//! animations key. Callbacks are queued as `StateEvent`s; drain them with `drain_events`.

use crate::model::SkeletonData;
use crate::pose::Pose;

/// A playing animation on a track.
#[derive(Clone, Debug)]
pub struct TrackEntry {
    pub track: usize,
    pub animation: usize,
    pub looping: bool,
    pub mix_duration: f64,
    pub mix_time: f64,
    /// Queued entries: seconds after the previous entry started, or None to start when it ends.
    pub delay: Option<f64>,
    pub time: f64,
    last_time: f64,
    fresh: bool,
    /// Influence of the track (layers).
    pub alpha: f64,
    pub time_scale: f64,
    /// The entry being faded out.
    pub previous: Option<Box<TrackEntry>>,
    pub queue: Vec<TrackEntry>,
    /// Unique id, to match events to entries.
    pub id: u64,
}

impl TrackEntry {
    fn new(id: u64, track: usize, animation: usize, looping: bool, mix: f64, delay: Option<f64>) -> TrackEntry {
        TrackEntry { track, animation, looping, mix_duration: mix, mix_time: 0.0, delay, time: 0.0, last_time: -1.0, fresh: true, alpha: 1.0, time_scale: 1.0, previous: None, queue: Vec::new(), id }
    }

    /// Mix progress in [0, 1]: how much this entry has replaced the previous one.
    pub fn mix(&self) -> f64 {
        if self.mix_duration > 0.0 {
            (self.mix_time / self.mix_duration).min(1.0)
        } else {
            1.0
        }
    }
}

/// An event key merged with its definition.
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub name: String,
    pub time: f64,
    pub loop_index: i64,
    pub int: i64,
    pub float: f64,
    pub string: Option<String>,
    pub audio: Option<String>,
    pub volume: f64,
    pub balance: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StateEventKind {
    Start,
    /// Replaced or cleared.
    End,
    /// Reached its end (every loop for looping entries).
    Complete,
    Event(Event),
}

#[derive(Clone, Debug, PartialEq)]
pub struct StateEvent {
    pub kind: StateEventKind,
    pub track: usize,
    pub animation: usize,
    pub entry: u64,
}

#[derive(Clone, Debug, Default)]
pub struct AnimationState {
    /// Entries by track index (None = empty track).
    pub tracks: Vec<Option<TrackEntry>>,
    /// Playback speed multiplier for every track.
    pub speed: f64,
    /// Seconds since the last `apply`, simulated by physics constraints then.
    pub physics_delta: f64,
    events: Vec<StateEvent>,
    next_id: u64,
}

impl AnimationState {
    pub fn new() -> AnimationState {
        AnimationState { speed: 1.0, ..Default::default() }
    }

    /// Takes the callbacks queued since the last call, in order.
    pub fn drain_events(&mut self) -> Vec<StateEvent> {
        std::mem::take(&mut self.events)
    }

    fn notify(&mut self, kind: StateEventKind, e: &TrackEntry) {
        self.events.push(StateEvent { kind, track: e.track, animation: e.animation, entry: e.id });
    }

    fn entry(&mut self, track: usize, animation: usize, looping: bool, mix: f64, delay: Option<f64>) -> TrackEntry {
        self.next_id += 1;
        TrackEntry::new(self.next_id, track, animation, looping, mix, delay)
    }

    /// Base track: starts `name`, crossfading over `mix` seconds. False if not found.
    pub fn play(&mut self, sk: &SkeletonData, name: &str, looping: bool, mix: f64) -> bool {
        self.set_animation(sk, 0, name, looping, mix).is_some()
    }

    /// Starts `name` on `track` now, crossfading over `mix` seconds and dropping anything queued.
    /// Returns the entry id, or None when no animation has that name.
    pub fn set_animation(&mut self, sk: &SkeletonData, track: usize, name: &str, looping: bool, mix: f64) -> Option<u64> {
        let animation = sk.find_animation(name)?;
        let entry = self.entry(track, animation, looping, mix, None);
        let id = entry.id;
        if self.tracks.len() <= track {
            self.tracks.resize(track + 1, None);
        }
        match self.tracks[track].take() {
            Some(mut current) => {
                for q in std::mem::take(&mut current.queue) {
                    self.notify(StateEventKind::End, &q);
                }
                self.replace(current, entry);
            }
            None => {
                self.notify(StateEventKind::Start, &entry);
                self.tracks[track] = Some(entry);
            }
        }
        Some(id)
    }

    /// Queues `name` on `track` after the current entry (or the last queued one): when it ends,
    /// or `delay` seconds after it starts. Starts right away on an empty track.
    pub fn add_animation(&mut self, sk: &SkeletonData, track: usize, name: &str, looping: bool, mix: f64, delay: Option<f64>) -> Option<u64> {
        if self.tracks.get(track).is_none_or(Option::is_none) {
            return self.set_animation(sk, track, name, looping, mix);
        }
        let animation = sk.find_animation(name)?;
        let entry = self.entry(track, animation, looping, mix, delay);
        let id = entry.id;
        self.tracks[track].as_mut().unwrap().queue.push(entry);
        Some(id)
    }

    /// Stops a track (its animation stops affecting the pose).
    pub fn clear_track(&mut self, track: usize) {
        let Some(Some(mut current)) = self.tracks.get_mut(track).map(Option::take) else { return };
        if let Some(prev) = current.previous.take() {
            self.notify(StateEventKind::End, &prev);
        }
        self.notify(StateEventKind::End, &current);
        for q in std::mem::take(&mut current.queue) {
            self.notify(StateEventKind::End, &q);
        }
    }

    pub fn stop(&mut self) {
        for i in 0..self.tracks.len() {
            self.clear_track(i);
        }
        self.tracks.clear();
    }

    pub fn current(&self, track: usize) -> Option<&TrackEntry> {
        self.tracks.get(track).and_then(Option::as_ref)
    }

    pub fn current_mut(&mut self, track: usize) -> Option<&mut TrackEntry> {
        self.tracks.get_mut(track).and_then(Option::as_mut)
    }

    fn replace(&mut self, mut from: TrackEntry, mut to: TrackEntry) {
        // A fade that has not finished keeps fading out from the newest pose.
        if let Some(prev) = from.previous.take() {
            self.notify(StateEventKind::End, &prev);
        }
        if to.mix_duration > 0.0 {
            to.previous = Some(Box::new(from));
        } else {
            self.notify(StateEventKind::End, &from);
        }
        self.notify(StateEventKind::Start, &to);
        let track = to.track;
        self.tracks[track] = Some(to);
    }

    /// Advances time by `dt` seconds, starting queued entries and firing events.
    pub fn update(&mut self, sk: &SkeletonData, dt: f64) {
        let dt = dt * self.speed;
        self.physics_delta += dt;
        for track in 0..self.tracks.len() {
            let Some(mut entry) = self.tracks[track].take() else { continue };
            self.advance(sk, &mut entry, dt);
            // Start the next queued entry once its time comes.
            if let Some(next) = entry.queue.first() {
                let duration = sk.animations.get(entry.animation).map_or(0.0, |a| a.duration);
                let start = next.delay.unwrap_or_else(|| (duration - next.mix_duration).max(0.0));
                if entry.time >= start {
                    let mut next = entry.queue.remove(0);
                    next.queue = std::mem::take(&mut entry.queue);
                    // Carry over the time past the switch point.
                    next.time = (entry.time - start).max(0.0);
                    next.mix_time = next.time;
                    next.last_time = -1.0;
                    next.fresh = false;
                    self.replace(entry, next);
                    let started = self.tracks[track].take().unwrap();
                    self.fire_events(sk, &started);
                    self.tracks[track] = Some(started);
                    continue;
                }
            }
            self.tracks[track] = Some(entry);
        }
    }

    fn advance(&mut self, sk: &SkeletonData, entry: &mut TrackEntry, dt: f64) {
        let step = dt * entry.time_scale;
        entry.last_time = if entry.fresh { -1.0 } else { entry.time };
        entry.fresh = false;
        entry.time += step;
        entry.mix_time += step;
        self.fire_events(sk, entry);
        if let Some(prev) = entry.previous.as_mut() {
            // The entry fading out keeps playing, firing its events, until the mix ends.
            prev.last_time = prev.time;
            prev.time += dt * prev.time_scale;
            let snapshot = (**prev).clone();
            self.fire_events(sk, &snapshot);
            if entry.mix_time >= entry.mix_duration {
                let prev = entry.previous.take().unwrap();
                self.notify(StateEventKind::End, &prev);
            }
        }
    }

    /// Fires the events and completions between an entry's last and current time.
    fn fire_events(&mut self, sk: &SkeletonData, entry: &TrackEntry) {
        let Some(anim) = sk.animations.get(entry.animation) else { return };
        let d = anim.duration;
        let (from, to) = (entry.last_time, entry.time);
        if to < from {
            return;
        }
        let fire = |s: &mut AnimationState, t0: f64, t1: f64, loop_index: i64| {
            for e in &anim.events {
                if e.time > t0 && e.time <= t1 {
                    let def = sk.events.iter().find(|d| d.name == e.name);
                    let event = Event {
                        name: e.name.clone(),
                        time: e.time,
                        loop_index,
                        int: e.int.or(def.map(|d| d.int)).unwrap_or(0),
                        float: e.float.or(def.map(|d| d.float)).unwrap_or(0.0),
                        string: e.string.clone().or_else(|| def.and_then(|d| d.string.clone())),
                        audio: def.and_then(|d| d.audio.clone()),
                        volume: e.volume.or(def.map(|d| d.volume)).unwrap_or(1.0),
                        balance: e.balance.or(def.map(|d| d.balance)).unwrap_or(0.0),
                    };
                    s.notify(StateEventKind::Event(event), entry);
                }
            }
        };
        if !entry.looping || d <= 0.0 {
            fire(self, from, to.min(d), 0);
            if from < d && to >= d {
                self.notify(StateEventKind::Complete, entry);
            }
            return;
        }
        // Looping: fire per loop crossed.
        let start_loop = (from.max(0.0) / d).floor() as i64;
        let end_loop = (to / d).floor() as i64;
        for loop_index in start_loop..=end_loop {
            let t0 = if loop_index == start_loop { from - loop_index as f64 * d } else { -1.0 };
            let t1 = if loop_index == end_loop { to - loop_index as f64 * d } else { d };
            fire(self, t0, t1, loop_index);
            if loop_index < end_loop {
                self.notify(StateEventKind::Complete, entry);
            }
        }
    }

    /// Resets `pose` to setup, applies every track in order and updates world transforms.
    pub fn apply(&mut self, sk: &SkeletonData, pose: &mut Pose) {
        pose.reset(sk);
        pose.physics_delta = self.physics_delta;
        self.physics_delta = 0.0;
        for entry in self.tracks.iter().flatten() {
            let layer = if entry.track == 0 { 1.0 } else { entry.alpha };
            if let Some(prev) = &entry.previous {
                apply_entry(sk, pose, prev, layer * prev.alpha);
            }
            let alpha = (if entry.previous.is_some() { entry.mix() } else { 1.0 }) * (if entry.track == 0 { entry.alpha } else { layer });
            apply_entry(sk, pose, entry, alpha);
        }
        pose.update_world(sk);
    }
}

fn apply_entry(sk: &SkeletonData, pose: &mut Pose, entry: &TrackEntry, alpha: f64) {
    let Some(anim) = sk.animations.get(entry.animation) else { return };
    if alpha <= 0.0 {
        return;
    }
    // The same arithmetic as the JavaScript runtime, so loop boundaries land on the same frame.
    let time = if entry.looping && anim.duration > 0.0 { ((entry.time % anim.duration) + anim.duration) % anim.duration } else { entry.time.min(anim.duration) };
    pose.apply(sk, entry.animation, time, alpha.min(1.0));
}
