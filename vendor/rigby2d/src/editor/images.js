// SPDX-License-Identifier: MIT OR Apache-2.0
// In-memory image store: canvases keyed by image name, with cached alpha and tinted copies.

export class Images {
  constructor() {
    /** @type {Map<string, {canvas: HTMLCanvasElement, alpha: Uint8ClampedArray|null, tints: Map<string, HTMLCanvasElement>}>} */
    this.map = new Map();
  }

  insert(name, canvas) {
    this.map.set(name, { canvas, alpha: null, tints: new Map() });
  }

  /** Inserts raw RGBA pixels: { width, height, data: Uint8ClampedArray }. */
  insertRgba(name, rgba) {
    this.insert(name, canvasFromRgba(rgba));
  }

  get(name) {
    return this.map.get(name)?.canvas;
  }

  contains(name) {
    return this.map.has(name);
  }

  clear() {
    this.map.clear();
  }

  /** Alpha (0-255) of a pixel, or null if the image is unknown. */
  alphaAt(name, x, y) {
    const s = this.map.get(name);
    if (!s) return null;
    const { width, height } = s.canvas;
    if (!s.alpha) {
      const data = s.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      s.alpha = new Uint8ClampedArray(width * height);
      for (let i = 0; i < s.alpha.length; i++) s.alpha[i] = data[i * 4 + 3];
    }
    x = Math.min(Math.max(0, x), width - 1);
    y = Math.min(Math.max(0, y), height - 1);
    return s.alpha[y * width + x];
  }

  /** The image multiplied by an RGB color (alpha is applied by the caller). */
  tinted(name, color) {
    const s = this.map.get(name);
    if (!s) return null;
    if (color[0] >= 1 && color[1] >= 1 && color[2] >= 1) return s.canvas;
    const key = color.slice(0, 3).map((c) => Math.round(c * 255)).join(',');
    let t = s.tints.get(key);
    if (!t) {
      t = document.createElement('canvas');
      t.width = s.canvas.width;
      t.height = s.canvas.height;
      const ctx = t.getContext('2d');
      ctx.drawImage(s.canvas, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${key})`;
      ctx.fillRect(0, 0, t.width, t.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(s.canvas, 0, 0);
      if (s.tints.size > 64) s.tints.clear();
      s.tints.set(key, t);
    }
    return t;
  }
}

export function canvasFromRgba({ width, height, data }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (width > 0 && height > 0) canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

/** Copies a rectangle out of a canvas into a new canvas. */
export function cropCanvas(src, x, y, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return c;
}
