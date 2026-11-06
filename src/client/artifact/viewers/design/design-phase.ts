/**
 * dsh-canvas — 设计预览加载盖板的**阶段判定**（纯，没有 React、没有 DOM）。
 *
 * 盖板什么时候在、说什么，只有这一处说了算。抽出来的理由是它会**静默地错成两个方向**：
 *
 * - 撤早了（引擎就绪就撤）：`setState({kind:'ready'})` 之后还有一次同步的整页录制
 *   （yoga 布局 + Skia picture，实测 200–500ms），撤早了那一段就是白屏——正是要修的那个
 *   观感。
 * - 撤晚了（等别的东西）：盖板一直盖着，画好的画面被人看不见，比白屏更糟。
 *
 * 所以它值得一条能真跑的判据，而不是躺在组件里靠肉眼。
 */

/** 加载盖板的两个阶段。 */
export type DesignPhase = 'engine' | 'paint'

/**
 * 此刻盖板该说的是哪一段；`null` = 撤下。
 *
 * - `loading` → `engine`：资源在路上（wasm、引擎 chunk、默认字面）。**只在第一次**打开时付。
 * - `ready` 但首帧还没落屏 → `paint`：引擎有了，布局与整页录制还没跑完。**每次**打开都要付。
 * - `ready` 且画过了 → 撤下。
 * - `error` → 撤下：错误有自己那一条（`.dsh-canvas-design-note`），盖板压在上面只会让人
 *   看不见报错。
 *
 * 参数只取 `kind` 而不是整个 state：这个判定与那条诊断消息的内容无关，写宽了会让人以为
 * 改文案能影响它。
 */
export function designPhaseOf(state: { kind: 'loading' | 'error' | 'ready' }, painted: boolean): DesignPhase | null {
  if (state.kind === 'loading') return 'engine'
  if (state.kind === 'ready' && !painted) return 'paint'
  return null
}
