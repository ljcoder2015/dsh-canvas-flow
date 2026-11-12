// SPDX-License-Identifier: MIT OR Apache-2.0
// dsh-canvas fork 桩：@huggingface/transformers 的替身。whisper.worker.js 静态 import 它，
// 但口型同步（本地 Whisper 推理）在画布嵌入里不启用——桩让构建通过，运行时调用即明确报错。
export const env = {};
export async function pipeline() {
  throw new Error('lipsync is disabled in the dsh-canvas embed');
}
export const TextStreamer = class {};
