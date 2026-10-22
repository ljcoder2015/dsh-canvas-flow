/**
 * 提示条：按消息类型上色 + 可以关掉（F10.1）。
 *
 * 反馈是「消息弹窗不明显」：三条收场（导出成了、这次没导成、打包出错）本来就长得一模一样——
 * 同一个 `--dsh-card` 底、同一副描边，字色只差一点点——用户得把一行字读完才知道刚才
 * 发生了什么。这一条把两件事钉住：**口气确实换了底色**，以及**每一条都能自己关掉**。
 *
 * 判据读的是源码文本（样式表 + jsx），因为这个缺陷是**纯视觉**的：跑一遍画布不会失败，
 * 它只是「看着还是老样子」。样式表读文本是既有先例（`theme-tokens.spec.ts`）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { css } from '../../../src/client/ui/styles.ts'

const VIEW = readFileSync(new URL('../../../src/client/canvas/board/canvas-view.tsx', import.meta.url), 'utf8')

/** 画布的全部口气档位；少一档就等于有一类消息没有颜色可用。 */
const TONES = ['info', 'ok', 'warn', 'error'] as const

/** 一档口气取的是哪一枚家族色令牌（就是它的背景色来源）。 */
function familyOf(tone: string): string | undefined {
  const pattern = new RegExp(`\\.dsh-canvas-notice\\[data-tone="${tone}"\\][^{]*\\{--dsh-notice:var\\((--dsh-[a-z0-9-]+)\\)`)
  return css.match(pattern)?.[1]
}

/** 亮色块里声明过的画布令牌（拼错一个名字不会报错，兜底值会永远生效——所以要对着它查）。 */
const lightBlock = css.slice(css.indexOf('.dsh-canvas-root{'), css.indexOf('}', css.indexOf('.dsh-canvas-root{')))
const declared = new Set([...lightBlock.matchAll(/--dsh-[a-z0-9-]+/g)].map((m) => m[0]))

/** 画布里那两条提示条的骨架规则（共用同一条）。 */
const STRIP = css.slice(css.indexOf('.dsh-canvas-error,.dsh-canvas-notice{'), css.indexOf('}', css.indexOf('.dsh-canvas-error,.dsh-canvas-notice{')))

describe('提示条：口气决定颜色', () => {
  it('四档都有一枚家族色——这就是「按消息类型换背景」这件事本身', () => {
    for (const tone of TONES) expect(familyOf(tone), `${tone} 没有家族色`).toBeDefined()
  })

  it('四档的家族色互不相同（同色等于没分档）', () => {
    const families = TONES.map((tone) => familyOf(tone))

    expect(new Set(families).size).toBe(TONES.length)
  })

  it('家族色都是画布调色板里真有的令牌（写错名字不会报错，只会永远走兜底）', () => {
    for (const tone of TONES) {
      const family = familyOf(tone)!
      expect(declared.has(family), `${tone} 取的 ${family} 不在调色板里`).toBe(true)
    }
  })

  it('底色由家族色算出来，而不是直接拿面板色当底（那正是「不明显」）', () => {
    expect(STRIP).toContain('background:color-mix(in srgb, var(--dsh-notice)')
    expect(STRIP).not.toContain('background:var(--dsh-card)')
    // 描边同样跟着口气走，否则四档只剩一层很淡的底可分辨。
    expect(STRIP).toContain('border:1px solid color-mix(in srgb, var(--dsh-notice)')
  })

  it('错误条不用挂属性就是错的色（它只有一档，卡片面里那条也走同一份样式）', () => {
    expect(css).toContain('.dsh-canvas-notice[data-tone="error"],.dsh-canvas-error{--dsh-notice:var(--dsh-twilight)}')
  })

  it('提示条把 tone 交出去（css 里那四档要真有人写）', () => {
    expect(VIEW).toContain('data-tone={notice.tone}')
  })
})

describe('提示条：可以关掉', () => {
  const buttons = [...VIEW.matchAll(/<button className="dsh-canvas-strip-close"([\s\S]*?)<\/button>/g)].map((m) => m[1])

  it('两条提示条各有一枚关闭（少一枚就有一条赖在画布上）', () => {
    expect(buttons).toHaveLength(2)
  })

  it('各自关掉的是自己那一条', () => {
    expect(buttons.some((body) => body.includes("setError('')"))).toBe(true)
    expect(buttons.some((body) => body.includes('setNotice(null)'))).toBe(true)
  })

  it('两枚都是有名字的按钮，不是一枚看不懂的图形', () => {
    for (const body of buttons) expect(body).toContain("t('canvas.action.dismiss')")
  })

  it('关闭按钮有样式，且提示条是能放下它的横排', () => {
    expect(css).toContain('.dsh-canvas-strip-close{')
    expect(css).toContain('.dsh-canvas-strip-close:hover{')
    // 横排 + 顶对齐：多行提示（一整行路径）折行时，关闭要留在第一行右边而不是被挤走。
    expect(STRIP).toContain('display:flex')
    expect(STRIP).toContain('align-items:flex-start')
  })
})
