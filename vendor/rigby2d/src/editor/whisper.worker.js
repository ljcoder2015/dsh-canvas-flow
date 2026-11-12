// SPDX-License-Identifier: MIT OR Apache-2.0
// Speech recognition for lip-sync, off the UI thread: Whisper (transformers.js) with word timestamps.
// The ONNX runtime ships with the editor (bundled into this worker); the model is downloaded from
// Hugging Face the first time and kept in the browser cache, so later runs work offline.

import { env, pipeline } from '@huggingface/transformers';

const MODEL = 'onnx-community/whisper-base_timestamped';

env.allowLocalModels = false;
env.useWasmCache = false;
// transformers.js points the runtime at a CDN; the copy bundled with the editor is used instead.
env.backends.onnx.wasm.wasmPaths = undefined;

let recognizer = null;

/** Download progress, summed over the model's files. */
const files = new Map();
const progress = (p) => {
  if (p.status !== 'progress' || !p.total) return;
  files.set(p.file, [p.loaded, p.total]);
  let loaded = 0;
  let total = 0;
  for (const [l, t] of files.values()) (loaded += l), (total += t);
  self.postMessage({ type: 'download', loaded, total });
};

self.onmessage = async ({ data }) => {
  try {
    if (!recognizer) {
      self.postMessage({ type: 'status', text: 'Loading the speech model…' });
      recognizer = await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8', progress_callback: progress });
    }
    self.postMessage({ type: 'status', text: 'Listening to the audio…' });
    const out = await recognizer(data.samples, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(data.language ? { language: data.language } : {}),
    });
    self.postMessage({ type: 'done', text: out.text, chunks: out.chunks ?? [] });
  } catch (e) {
    self.postMessage({ type: 'error', text: e?.message ?? String(e) });
  }
};
