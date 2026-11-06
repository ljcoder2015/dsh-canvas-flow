/**
 * dsh-canvas — 「同一帧只画一次」的闸（纯，注入 `requestAnimationFrame` / `cancelAnimationFrame`）。
 *
 * 引擎会在三种时候回头叫我们重画：字体到货、场景变更、切页。中文字面（17.7MB）注册进
 * CanvasKit 的那一刻，core 的 `settleFontDemand` 会**逐节点**结算一遍——实测一口气叫了
 * 88–153 次 `onRepaint`。每次都老实跑一遍 `draw`，就是同一帧里把整页重录上百遍：画面刚
 * 出来之后的卡顿全在这里。
 *
 * 合成一帧不改变语义（最坏延后 16ms），却把那一串并成一次。两条边界都是真会踩到的：
 *
 * - **跑完要能再排**：闸只挡「同一帧里的第二次」，画完之后下一次请求必须照常进来，否则
 *   这张卡就再也不更新了。
 * - **画的时候抛错也要放开闸**：`draw` 抛了异常仍把 in-flight 清掉，不然一张画坏了的卡
 *   会把之后所有的重画都吞掉——一个静默的死锁。
 */

/** 一帧闸：`schedule` 合并，`stop` 撤掉还没跑的那一帧。 */
export interface FrameGate {
  /** 排一帧；同帧内重复调用只跑一次。 */
  schedule(): void
  /** 撤掉已排但还没跑的那一帧（卸载时用）。 */
  stop(): void
}

/**
 * @param draw - 要合帧的那件事（通常是渲染器的一帧）。
 * @param request - `requestAnimationFrame` 的替身。
 * @param cancel - `cancelAnimationFrame` 的替身。
 */
export function createFrameGate(
  draw: () => void,
  request: (callback: () => void) => number,
  cancel: (handle: number) => void,
): FrameGate {
  let pending: number | null = null
  return {
    schedule(): void {
      if (pending !== null) return
      pending = request(() => {
        // 先放开闸再画：画的过程中若再次被 schedule（字体连环结算就是这样），那一帧应当
        // 照常排上，而不是被这一帧吞掉。
        pending = null
        draw()
      })
    },
    stop(): void {
      if (pending === null) return
      cancel(pending)
      pending = null
    },
  }
}
