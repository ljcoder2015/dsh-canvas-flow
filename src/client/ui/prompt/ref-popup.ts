/**
 * dsh-canvas — `@` 引用弹窗里那三件**纯**事：什么时候冒出来、摆在哪、点下去插什么。
 *
 * 从 `prompt-input.tsx` 与 `card-overlay.tsx` 里请出来的这一半不碰 React、不碰 DOM，于是
 * node 环境就能真跑判据。三件事写在一个模块里，因为它们共用同一个坐标——**那一枚 `@`**：
 * 查询是它后面那截字（{@link queryAt}），弹窗摆在它旁边（{@link placePopup}），点下去插进
 * 去的记号顶掉的正是它那半枚（{@link mentionInsertion}）。
 *
 * ## 一条改过的判定：`@` 不再要求「在词首」
 *
 * v1.85 之前只认**词首**那个 `@`（串首，或前一个字符是空白）——那是宿主记号语法的一条
 * 边界（`foo@bar` 里的 `@` 不是引用），当初被顺手抄到了「要不要弹候选」上。结果是一句话
 * 写到一半想引用一张卡，得先把光标挪到词首、敲个空格、再敲 `@`。用户原话：「提示词输入
 * 改成可以在提示中间任意位置 @ 就激活引用弹窗列表」。
 *
 * 现在**只看光标前那截**：`@` 之后到光标之间没有空白，就认为用户在写引用（任意位置）。
 *
 * 两处代价说清楚，都是有意的：
 *
 * - **记号本身的语法一个字都没改**。`foo@bar` 仍然不是引用（`prompt-blocks.ts` 的扫描器
 *   与宿主的记号语法逐字对齐，改它等于改发出去的提示词）。所以插入时**前面补一个空格**
 *   ——见 {@link mentionInsertion}：用户在句子中间敲的 `@` 是他的手势，插进提示词的那串
 *   字符仍必须落在词首，否则那枚标签画不出来、宿主也不认。
 * - **写邮箱时 `@` 会闪一下弹窗**：`mai` → `@` 那一瞬菜单就冒出来了，接着 `l` 把候选滤空，
 *   菜单里写一句「没有可引用的文件」。这是「任意位置 `@` 就激活」这句话的直接后果——
 *   宁可多闪一下，也不要求用户先按一个空格。
 */

/** 一枚 `@` 在视口里的盒子（px）。弹窗按它定位，不按输入框定位。 */
export interface QueryAnchor {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** 弹窗与那一枚 `@` 之间的缝（px）。 */
export const POPUP_GAP = 6

/** 弹窗与视口边缘之间至少留出的距离（px）。 */
export const POPUP_MARGIN = 8

/**
 * 光标前那半枚 `@查询` 是什么；不成半边记号就是 `null`。
 *
 * 唯一一条限制是**查询里不能有空白**：`see @ 2pm` 这种话里那个 `@` 后面紧跟着空格，光标
 * 落在句尾时它早就不成记号了；而 `@` 本身落在哪儿都算（见文件头那条改过的判定）。
 *
 * @param text - the prompt as written.
 * @param caret - 光标在值里排第几（扁平偏移）。
 */
export function queryAt(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const query = before.slice(at + 1)
  return /\s/u.test(query) ? null : query
}

/** 那半枚 `@查询` 在值里的起点（就是那一枚 `@` 的位置）；没在写引用就是光标自己。 */
export function queryStart(text: string, caret: number): number {
  const query = queryAt(text, caret)
  return query === null ? caret : caret - query.length - 1
}

/**
 * 又报了一次查询之后，高亮该留在第几枚。
 *
 * 输入面在**每一次松键**（方向键也算）、聚焦、点选、滚动之后都会重报一遍当前查询——那是
 * 为了把弹窗按回那一枚 `@` 上（框里滚了，`@` 的位置就变了）。可「重报」不等于「换了搜索
 * 词」：顺手把高亮拨回第一枚，用户按一下 ↓ 就成了「挪一格又弹回第一枚」。
 *
 * 所以复位只认一个条件——**查询本身变了**（多打一个字、删掉一个字、菜单关了再开）。
 *
 * @param previous - 上一次报上来的查询。
 * @param next - 这一次报上来的查询。
 * @param picked - 现在高亮在第几枚。
 */
export function keptPick(previous: string | null, next: string | null, picked: number): number {
  return previous === next ? picked : 0
}

/** 一个盒子的宽高（弹窗量出来的、或者视口）。 */
export interface PopupBox {
  readonly width: number
  readonly height: number
}

/** 弹窗最终落在哪儿（视口坐标）以及它是不是翻到了上面。 */
export interface PopupPlacement {
  readonly left: number
  readonly top: number
  /** 下面放不下，翻到了 `@` 上面。 */
  readonly flipped: boolean
}

/**
 * 弹窗落点：**贴着那一枚 `@`，默认在它下面**，下面放不下就翻到上面，横向夹进视口。
 *
 * 为什么是**量完再摆**而不是纯 CSS：菜单的高度随候选条数变（0～8 条），宽度随卡片名变。
 * 只有真量过才知道「下面还放不放得下」，而「翻上去」这件事正是用户在屏幕下沿输入时唯一
 * 能救回来的那条路——卡片贴着窗口底边时，控制带本身的下面根本没有 220px。
 *
 * @param anchor - 那一枚 `@` 在视口里的盒子。
 * @param popup - 弹窗自己量出来的宽高。
 * @param viewport - 视口宽高。
 */
export function placePopup(anchor: QueryAnchor, popup: PopupBox, viewport: PopupBox): PopupPlacement {
  const below = anchor.bottom + POPUP_GAP
  const above = anchor.top - POPUP_GAP - popup.height
  const floor = viewport.height - POPUP_MARGIN
  const flipped = below + popup.height > floor && above >= POPUP_MARGIN
  const top = flipped ? above : Math.max(POPUP_MARGIN, Math.min(below, floor - popup.height))
  const left = Math.max(POPUP_MARGIN, Math.min(anchor.left, viewport.width - POPUP_MARGIN - popup.width))
  return { left, top, flipped }
}

/**
 * 选中一枚候选：那半枚 `@查询` 换成记号，返回新值与新光标。
 *
 * 两处补齐（都是「记号只在词首才算引用」这条语法的代价，见文件头）：
 *
 * - **前面**：紧贴着前一个字时补一个空格。用户是在句子中间敲的 `@`，但他插进提示词的
 *   仍是**宿主语法里的记号**——`看看@brief.md` 只会是一个奇怪的长单词：标签画不出来、
 *   宿主也不认，而用户在菜单里明明点了它。
 * - **后面**：后面紧跟的是字就补一个空格（`@brief.md` 后面直接接「改成…」会把两个记号
 *   粘成一个词）；后面本来就是空白或行尾就不再添。
 *
 * @param text - 提示词当前的值。
 * @param span - 要顶掉的那一段（`queryStart` 到光标）。
 * @param mention - `@path` / `@"my brief.md"` 那串记号。
 */
export function mentionInsertion(
  text: string,
  span: { readonly start: number; readonly end: number },
  mention: string,
): { readonly text: string; readonly caret: number } {
  const head = text.slice(0, span.start)
  const tail = text.slice(span.end)
  const lead = head === '' || /\s$/u.test(head) ? '' : ' '
  const trail = tail === '' || /^\s/u.test(tail) ? '' : ' '
  const inserted = `${lead}${mention}${trail}`
  return { text: `${head}${inserted}${tail}`, caret: span.start + inserted.length }
}
