// SPDX-License-Identifier: MIT OR Apache-2.0
// PNG encoding off the main thread: the offline renderer sends raw WebGL pixels (bottom row
// first, premultiplied alpha); the worker flips them, restores straight alpha and encodes a PNG.
// Several workers encode frames in parallel, which is where PNG sequences spend their time.

let canvas = null;

self.onmessage = async (e) => {
  const { id, width, height, pixels } = e.data;
  try {
    const px = new Uint8Array(pixels);
    const rgba = new Uint8ClampedArray(width * height * 4);
    const row = width * 4;
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * row;
      const dst = y * row;
      for (let x = 0; x < row; x += 4) {
        const a = px[src + x + 3];
        if (a === 0) continue;
        if (a === 255) {
          rgba[dst + x] = px[src + x];
          rgba[dst + x + 1] = px[src + x + 1];
          rgba[dst + x + 2] = px[src + x + 2];
        } else {
          const k = 255 / a;
          rgba[dst + x] = px[src + x] * k;
          rgba[dst + x + 1] = px[src + x + 1] * k;
          rgba[dst + x + 2] = px[src + x + 2] * k;
        }
        rgba[dst + x + 3] = a;
      }
    }
    if (!canvas || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    self.postMessage({ id, bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
