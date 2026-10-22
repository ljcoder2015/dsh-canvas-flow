/**
 * dsh-canvas — 拖动控制带右下角那颗把手时，尺寸该怎么走。
 *
 * 控制带的大小是**两个量**：整条带的宽，和输入框的高。后者单独存，是因为这条带的
 * 高不是自己定的——它是「材料行 + 输入框 + 底栏」三行自然长出来的（见 `styles.ts`）。
 * 于是放大只可能是「输入框多占了一些地方」：字号、行高、内边距、圆角与那三行结构
 * 一个都不动。放大的只是空间，不是换一副样子。
 *
 * 锚点在**卡片中心**：这条带横着与它所属的节点对齐，放大时左右两侧对称地长，输入区
 * 始终在节点正下方。这是有代价的，也是这个模块里唯一一个不显然的数——右下角那颗把
 * 手，同一个鼠标位移只有一半落在右沿（另一半跑去左沿了），所以宽度得按两倍吃位移，
 * 把手才跟得住光标（见 `CENTERED_WIDTH_GAIN`）。高度没有这一层：锚在上沿，向下长，
 * 一寸就是一寸。
 *
 * 存的数是**画布单位**。整条控制带坐在 `scale(zoom)` 的层里，而鼠标走的是屏幕像素，
 * 所以进出这里的每一个量都按 zoom 换算一次——把画布放到 200% 再拖，把手仍跟鼠标
 * 1:1，而不是走两倍。
 *
 * 单独一个模块、不碰任何宿主 UI 原语（与 `row-actions.ts`、`open-folder.ts` 同）：
 * 这一层是纯算术，且值得单测——拖动的感觉就是这几个数说了算。
 */

/** 一条控制带拖过之后的尺寸，画布单位。 */
export interface ComposerSize {
  /** 整条带的宽。输入框是 `width:100%`，所以它跟着一起走。 */
  readonly width: number
  /** 输入框的高。带上其余两行是自然高，多出来的地方全归这里。 */
  readonly inputHeight: number
}

/** 这一笔从起笔到此刻走过的距离，屏幕像素。 */
export interface ComposerDrag {
  readonly dx: number
  readonly dy: number
}

/**
 * 下限。
 *
 * 宽再窄就排不下底栏那一行（模型席位 150px 上限 + 发送）；输入框再矮就装不下一行字
 * （`COMPOSER_MIN_INPUT_HEIGHT` 与 CSS 的 `min-height` 是同一个数，改动要一起改）。
 * 下限也是「缩得回去」的保证：拖大了还能拖回默认大小，不会卡在放大值上。
 */
export const COMPOSER_MIN_WIDTH = 260
export const COMPOSER_MIN_INPUT_HEIGHT = 54

/**
 * 上限。
 *
 * 控制带是相对这张卡的一层浮层，大到这个份上已经顶得上半张画布；再让它长下去，用户
 * 想看的画布反倒被自己写提示词的那条带盖住了。
 */
export const COMPOSER_MAX_WIDTH = 780
export const COMPOSER_MAX_INPUT_HEIGHT = 420

/**
 * 量到的像素（屏幕）换算成画布单位。
 *
 * `zoom ≤ 0` 不该出现（域里是 `.positive()`），真出现了也不该把尺寸算成 `Infinity`
 * ——退回 1：画面看着不对，总好过整个布局炸掉。
 *
 * @param boxWidth - 控制带此刻的宽（`getBoundingClientRect().width`）。
 * @param inputHeight - 输入框此刻的高。
 * @param zoom - 画布缩放。
 */
export function composerSizeOf(boxWidth: number, inputHeight: number, zoom: number): ComposerSize {
  const scale = zoom > 0 ? zoom : 1
  return { width: boxWidth / scale, inputHeight: inputHeight / scale }
}

/**
 * 居中锚的换算：宽度走两倍。
 *
 * 这条带以卡片中心为轴（`card-overlay.tsx` 用 `translateX(-50%)` 钉的），所以鼠标
 * 右移一格，右沿只走半格、左沿反向也走半格。想让右沿——也就是把手所在的那条边——
 * 正着跟住光标，宽就得吃两倍的位移。反过来，如果把锚改回左上（钉住左沿），这个数就
 * 得回到 1：**两个地方必须一起改**，否则要么把手跟不上鼠标，要么宽走过一倍。
 */
const CENTERED_WIDTH_GAIN = 2

/**
 * 起笔时的尺寸 + 鼠标走过的距离 → 此刻的尺寸。
 *
 * 起笔那一刻量到的就是「现在多大」，所以第一下拖动**不会让控制带跳一下**：拖多少、
 * 涨多少。上下限都在这里收口。
 *
 * @param start - 起笔时的尺寸（`composerSizeOf` 量的）。
 * @param drag - 走过的屏幕像素。
 * @param zoom - 画布缩放。
 */
export function resizedComposerSize(start: ComposerSize, drag: ComposerDrag, zoom: number): ComposerSize {
  const scale = zoom > 0 ? zoom : 1
  return {
    width: clamp(
      start.width + (step(drag.dx) * CENTERED_WIDTH_GAIN) / scale,
      COMPOSER_MIN_WIDTH,
      COMPOSER_MAX_WIDTH,
    ),
    inputHeight: clamp(
      start.inputHeight + step(drag.dy) / scale,
      COMPOSER_MIN_INPUT_HEIGHT,
      COMPOSER_MAX_INPUT_HEIGHT,
    ),
  }
}

/** 走过的一格距离；不是有限数就当没动（一次坏的指针事件不该把尺寸算没）。 */
function step(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** 收进 `[min, max]`，并取整到整像素——半像素的宽会让每一次移动都白渲染一遍。 */
function clamp(value: number, min: number, max: number): number {
  const floor = Math.min(min, max)
  const ceiling = Math.max(min, max)
  return Math.round(Math.min(Math.max(value, floor), ceiling))
}
