/**
 * 提示条说什么 + 哪一档（F10.1）。
 *
 * 这一层是**判据**，不是文案：一条提示的口气决定它在画布上是什么颜色，而口气错了不会有
 * 任何东西报错——一条「这次没导成」涂成成功色，和它涂成出错色，代码都跑得通。所以三种
 * 收场各该是哪一档，在这里逐条钉住；界面那一侧只负责把 tone 画成颜色。
 *
 * 两条界线是这张表真正的价值所在：
 *  - **被拒不是出错**（产物没写 / 目录空 / 装不下）：它们是「没导成，以及为什么」。
 *  - **只有客户端自己动手那一步抛了异常才是出错**（装包、PDF 排版）。
 */
import { describe, expect, it } from 'vitest'
import {
  bundleFailedNotice,
  bundleNotice,
  designExportNotice,
  exportWorkingNotice,
  pruneNotice,
  textExportNotice,
  type NoticeTranslate,
} from '../../../../src/client/canvas/asset/notice.ts'
import type { BundleRefusal } from '../../../../src/client/canvas/export/bundle-export.ts'
import type { DesignRefusal } from '../../../../src/client/canvas/export/design-export.ts'

/** 一个只回显键与参数的翻译器，于是断言钉的是**调用形态**（键 + 参数），不是文案。 */
const t = ((key: string, args?: Record<string, unknown>) =>
  args === undefined
    ? key
    : `${key}(${Object.entries(args)
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(',')})`) as unknown as NoticeTranslate

describe('一次打包的收场', () => {
  it('成了就是 ok，报出文件名与条目数', () => {
    const notice = bundleNotice({ kind: 'done', name: '应用1.zip', files: 3, bytes: 512 }, t)

    expect(notice.text).toBe('canvas.export.bundleDone(name=应用1.zip,count=3)')
    expect(notice.tone).toBe('ok')
  })

  const REFUSALS: ReadonlyArray<{ reason: BundleRefusal; key: string }> = [
    { reason: 'absent', key: 'canvas.export.absent' },
    { reason: 'empty', key: 'canvas.export.bundleEmpty' },
    { reason: 'truncated', key: 'canvas.export.bundleTruncated' },
  ]

  it('三种拒绝各有各的一句话（下一步不一样），但都不是「出错」', () => {
    for (const { reason, key } of REFUSALS) {
      const notice = bundleNotice({ kind: 'refused', reason }, t)

      expect(notice.text, reason).toBe(key)
      // 这就是那一档判据：没导成 ≠ 出错。涂成 error 会让用户以为插件坏了。
      expect(notice.tone, reason).toBe('warn')
    }
  })

  it('三句话互不相同——合成一句「导出失败」就等于把下一步也省掉了', () => {
    const texts = REFUSALS.map(({ reason }) => bundleNotice({ kind: 'refused', reason }, t).text)

    expect(new Set(texts).size).toBe(texts.length)
  })

  it('装包这一步抛错才是 error，并且带得出原因', () => {
    const notice = bundleFailedNotice(new Error('out of memory'), t)

    expect(notice.text).toBe('canvas.export.bundleFailed(reason=out of memory)')
    expect(notice.tone).toBe('error')
    // 抛出来的不一定是 Error（宿主/浏览器都可能给别的），照实转字符串，别渲染成 [object]。
    expect(bundleFailedNotice('boom', t).text).toBe('canvas.export.bundleFailed(reason=boom)')
  })
})

describe('一次文本导出的收场', () => {
  it('读不到产物是 warn，不是 error', () => {
    expect(textExportNotice({ kind: 'absent' }, t)).toEqual({ text: 'canvas.export.absent', tone: 'warn' })
    expect(textExportNotice({ kind: 'truncated' }, t)).toEqual({ text: 'canvas.export.truncated', tone: 'warn' })
  })

  it('排版那一步抛错是 error', () => {
    const notice = textExportNotice({ kind: 'failed', reason: new Error('no font') }, t)

    expect(notice.text).toBe('canvas.export.pdfFailed(reason=no font)')
    expect(notice.tone).toBe('error')
  })

  it('成了就是 ok', () => {
    expect(textExportNotice({ kind: 'done', name: '笔记.md' }, t)).toEqual({
      text: 'canvas.export.done(name=笔记.md)',
      tone: 'ok',
    })
  })
})

describe('一次设计导出的收场（v1.59）', () => {
  const REFUSALS: ReadonlyArray<{ reason: DesignRefusal; key: string }> = [
    { reason: 'absent', key: 'canvas.export.absent' },
    { reason: 'truncated', key: 'canvas.export.truncated' },
    { reason: 'broken', key: 'canvas.export.designBroken' },
    { reason: 'empty', key: 'canvas.export.designEmpty' },
    { reason: 'no-engine', key: 'canvas.export.designNoEngine' },
  ]

  it('五种拒绝各有各的一句话（下一步不一样），且都不是「出错」', () => {
    for (const { reason, key } of REFUSALS) {
      const notice = designExportNotice({ kind: 'refused', reason }, t)

      expect(notice.text, reason).toBe(key)
      // 产物没写、只读到半份、文档解不开、一个容器都没有、这台机器上取不到渲染引擎——
      // 五件事没有一件是「插件坏了」。涂成 error 会把用户引到错误的方向去。
      expect(notice.tone, reason).toBe('warn')
    }
    expect(new Set(REFUSALS.map(({ reason }) => designExportNotice({ kind: 'refused', reason }, t).text)).size).toBe(
      REFUSALS.length,
    )
  })

  it('一件就报文件名；多件报出件数——用户得知道拿到的是几份', () => {
    expect(designExportNotice({ kind: 'done', name: '设计1.fig', files: 1 }, t)).toEqual({
      text: 'canvas.export.done(name=设计1.fig)',
      tone: 'ok',
    })
    expect(designExportNotice({ kind: 'done', name: '设计1.zip', files: 2 }, t)).toEqual({
      text: 'canvas.export.designPacked(name=设计1.zip,count=2)',
      tone: 'ok',
    })
  })

  it('画/装那一步真的抛了异常才是 error', () => {
    expect(designExportNotice({ kind: 'failed', reason: new Error('CanvasKit 没起来') }, t)).toEqual({
      text: 'canvas.export.designFailed(reason=CanvasKit 没起来)',
      tone: 'error',
    })
  })

  it('还没收场时先说一句，口气是中性的——那不是成功也不是失败', () => {
    expect(exportWorkingNotice(t)).toEqual({ text: 'canvas.export.working', tone: 'info' })
  })
})

describe('一次清理失效卡', () => {
  it('清光了是 ok', () => {
    expect(pruneNotice(3, 3, t)).toEqual({ text: 'canvas.prune.done(count=3)', tone: 'ok' })
  })

  it('有留下的（读不到、证不出不存在）是 warn，并报出实数', () => {
    expect(pruneNotice(1, 3, t)).toEqual({
      text: 'canvas.prune.partial(removed=1,skipped=2)',
      tone: 'warn',
    })
  })
})
