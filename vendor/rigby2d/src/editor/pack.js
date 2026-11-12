// SPDX-License-Identifier: MIT OR Apache-2.0
// Texture atlas packing.

const PAD = 2;
const MAX = 8192;

export function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Shelf-packs `items` ({ name, width, height }) into a power-of-two sheet with 2px padding.
 * Returns { width, height, regions } with regions sorted by name.
 */
export function pack(items) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].height - items[a].height);
  const widest = items.reduce((m, it) => Math.max(m, it.width + PAD * 2), 1);
  let width = Math.max(256, nextPowerOfTwo(widest));
  for (;;) {
    let x = PAD;
    let y = PAD;
    let shelf = 0;
    const placed = [];
    for (const i of order) {
      const { width: w, height: h } = items[i];
      if (x + w + PAD > width) {
        x = PAD;
        y += shelf + PAD;
        shelf = 0;
      }
      placed.push({ i, x, y });
      x += w + PAD;
      shelf = Math.max(shelf, h);
    }
    const height = nextPowerOfTwo(y + shelf + PAD);
    if (height <= width * 2 || width >= MAX) {
      if (width > MAX || height > MAX) throw new Error(`images do not fit in an ${MAX}px atlas`);
      const regions = placed.map(({ i, x, y }) => ({ name: items[i].name, x, y, width: items[i].width, height: items[i].height }));
      regions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { width, height, regions };
    }
    width *= 2;
  }
}
