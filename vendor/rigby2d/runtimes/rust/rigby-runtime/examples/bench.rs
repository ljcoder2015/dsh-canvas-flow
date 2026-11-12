// SPDX-License-Identifier: MIT OR Apache-2.0
//! Times animating one character for one frame (apply the animation, solve constraints, compute
//! world transforms and vertices), median of 2000 frames:
//! `cargo run --release --example bench -- <skeleton> [animation]`.
use rigby_runtime::{load_skeleton, AnimationState, Pose};
use std::time::Instant;

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: bench <skeleton file> [animation]");
    let data = load_skeleton(&std::fs::read(&path).expect("read")).expect("load");
    let anim = args.next().unwrap_or_else(|| data.find_animation("walk").map_or_else(|| data.animations[0].name.clone(), |i| data.animations[i].name.clone()));
    let mut pose = Pose::new(&data);
    let mut state = AnimationState::new();
    state.play(&data, &anim, true, 0.0);
    let mut times = Vec::with_capacity(2000);
    for _ in 0..2200 {
        let t = Instant::now();
        state.update(&data, 1.0 / 60.0);
        state.apply(&data, &mut pose);
        std::hint::black_box(pose.quads(&data));
        times.push(t.elapsed().as_secs_f64() * 1e6);
    }
    times.drain(..200);
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{} '{}': {} bones, median {:.1} us per frame", std::path::Path::new(&path).file_name().unwrap().to_string_lossy(), anim, data.bones.len(), times[times.len() / 2]);
}
