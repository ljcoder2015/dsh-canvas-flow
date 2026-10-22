/**
 * dsh-canvas — 卡面素材的取用方式：单飞 + 有界。
 *
 * 卡片预览要按 `bytes` 取素材，而 `bytes` 是「文件被重写过」最便宜的凭证：
 * `updatedAt` 每次重读都会变（它是读的时刻，不是写的时刻），当不了缓存键。
 *
 * 两条纪律都在这个函数里，且都跟「卡面一次能有多少张」有关：
 *
 * - **单飞**：同一张卡在同一时刻只发一次请求。画布重绘、缩放、拖动都会重跑渲染，
 *   而一次读可能是两兆的 HTML 或十几兆的视频字节。
 * - **有界**：缓存有容量上限，超限按插入序淘汰最老的一条。不设上限就是一个内存漏斗。
 *   淘汰与飞行中的请求无关——Promise 已经交出去了，结果只是不再被后来的调用者复用，
 *   并不会被取消（取消是调用方的事，见各 hook 的 `cancelled`）。
 */
export function cachedFetch<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  max: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const pending = fetcher()
  cache.set(key, pending)
  if (cache.size > max) {
    const oldest = cache.keys().next()
    if (oldest.done !== true) cache.delete(oldest.value)
  }
  return pending
}
