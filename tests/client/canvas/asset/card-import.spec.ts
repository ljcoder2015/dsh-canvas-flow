/**
 * 客户端那一半的「导入」判据（F2.7，v1.81）。
 *
 * 这一段在浏览器里：`<input type="file">`、`FileReader`、React 的 effect/callback，node
 * 下跑不起来（也不该为它套一层假 DOM，理由见 `card-aspect.spec.ts`）。所以照本仓的既有做法
 * ——读源码文本判**接线与守卫**，判据本身读的是「这一段真的把那个值递下去了」。
 *
 * 五件事，各对应一种真会发生的失败：
 *
 * 1. **按钮只出现在媒体卡上**：文本 / 设计 / 应用卡上冒出一枚〔导入〕，就是把一张图塞进一个
 *    「能打字」或「能跑」的产物里。
 * 2. **`accept` 是推出来的**：手写 `image/*,video/*,audio/*` 是第二个来源，媒体表加一种
 *    格式它不会跟着变。
 * 3. **同一份文件能选第二次**：不清 `value`，第二次选择不会触发 `change`，用户会以为按钮坏了。
 * 4. **被拒时连字节都不读**：一个 80MB 的视频先编码再被拒，用户等的是几十秒，看到的是一句
 *    本可以在点下按钮那一刻就说出的话。
 * 5. **只有真导进去了才刷新板面**：字节变了卡面要重读、形态可能跟着扩展名变；被拒时什么都
 *    没发生，不该惊动板面。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../../../../src/client/ui/locales.ts'
import type { CanvasKey } from '../../../../src/client/ui/locales.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** 把注释剥掉：注释里写着「`image/*`」这类词，不能让它们当成代码证据。 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const OVERLAY = code(read('../../../../src/client/canvas/card/card-overlay.tsx'))
const IMPORT_FILE = code(read('../../../../src/client/canvas/asset/import-file.ts'))
const VIEW = code(read('../../../../src/client/canvas/board/canvas-view.tsx'))
const NOTICE = code(read('../../../../src/client/canvas/asset/notice.ts'))
const PILL_SRC = read('../../../../src/client/canvas/card/card-overlay.tsx')

describe('胶囊上的那枚〔导入〕', () => {
  it('按钮在表里，且只对媒体卡渲染', () => {
    expect(PILL_SRC).toMatch(/\['canvas\.action\.import', 'onImport'\]/)
    expect(OVERLAY).toMatch(/const canImport = isMediaKind\(summary\?\.kind \?\? card\.kind\)/)
    expect(OVERLAY).toMatch(/if \(key === 'canvas\.action\.import'\) \{[\s\S]{0,120}?if \(!canImport\) return null/)
  })

  it('判「是不是媒体」用形态表，不手写三种名字', () => {
    for (const kind of ['image', 'video', 'audio']) {
      expect(OVERLAY, `胶囊里不该拿 kind 比 '${kind}'`).not.toContain(`kind === '${kind}'`)
    }
    expect(OVERLAY).toMatch(/isMediaKind/)
  })

  it('accept 来自媒体 MIME 表（推出来的），不是手写通配符', () => {
    expect(OVERLAY).toMatch(/accept=\{MEDIA_ACCEPT\}/)
    expect(OVERLAY, '手写三族通配符＝第二个来源').not.toMatch(/accept="image\/\*/)
  })

  it('原生 input 被藏起来，且 type=file', () => {
    expect(OVERLAY).toMatch(/className="dsh-canvas-fileinput"[\s\S]{0,80}type="file"/)
    expect(read('../../../../src/client/ui/styles.ts')).toMatch(/\.dsh-canvas-fileinput\{display:none\}/)
  })

  it('选完先清 value：不清的话，同一份文件选第二次不会再触发 change', () => {
    const pill = OVERLAY.slice(OVERLAY.indexOf('function ImportPill('))
    const clear = pill.indexOf("event.target.value = ''")
    const pick = pill.indexOf('onPick(file)')
    expect(clear).toBeGreaterThan(0)
    expect(pick).toBeGreaterThan(clear)
  })

  it('胶囊只选文件：它不读字节、不调 bridge（那三件事都要读摘要/刷新/发提示）', () => {
    const pill = OVERLAY.slice(OVERLAY.indexOf('function ImportPill('), OVERLAY.indexOf('function ExportPill('))
    expect(pill).not.toMatch(/FileReader|bridge\./)
  })
})

describe('验 → 读 → 送', () => {
  it('先判能不能导，再读字节（被拒时连字节都不读）', () => {
    const check = IMPORT_FILE.indexOf('importCheckOf(file)')
    const readStep = IMPORT_FILE.indexOf('readBase64(file)')
    expect(check).toBeGreaterThan(0)
    expect(readStep).toBeGreaterThan(check)
    // 拒绝那一支必须在读之前就 return。
    const refused = IMPORT_FILE.indexOf("if (refusal !== undefined) return { kind: 'refused'")
    expect(refused).toBeGreaterThan(check)
    expect(refused).toBeLessThan(readStep)
  })

  it('客户端判的是同一条规矩：复用的就是宿主那份 importPlanOf', () => {
    expect(IMPORT_FILE).toMatch(/importPlanOf\(\{ name: file\.name, size: file\.size, current: '', taken: async \(\) => false \}\)/)
  })

  it('读法用 readAsDataURL，并在这一侧就把 data: 前缀剥掉（宿主只要字节）', () => {
    expect(IMPORT_FILE).toMatch(/reader\.readAsDataURL\(file\)/)
    expect(IMPORT_FILE).toMatch(/url\.slice\(comma \+ 1\)/)
  })
})

describe('画布那一侧的收场', () => {
  it('导入走 importFromFile，提示条走 importNotice', () => {
    expect(VIEW).toMatch(/importFromFile\(bridge, projectId, card\.id, file, before\)/)
    expect(VIEW).toMatch(/setNotice\(importNotice\(outcome, t\)\)/)
  })

  it('只有真的导进去了才刷新板面（被拒时什么都没发生）', () => {
    expect(VIEW).toMatch(/if \(outcome\.kind === 'imported'\) setStamp\(/)
  })

  it('「替换」与「导入」由「导入前这张卡有没有产物」决定', () => {
    expect(VIEW).toMatch(/present: \(summaries\[card\.id\]\?\.bytes \?\? 0\) > 0/)
    expect(NOTICE).toMatch(/outcome\.replaced \? 'canvas\.import\.replaced' : 'canvas\.import\.done'/)
  })

  it('三种拒绝各有各的话，而且都是 warn——被拒不是出错', () => {
    const notice = NOTICE.slice(NOTICE.indexOf('export function importNotice('))
    expect(notice).toMatch(/unsupported: 'canvas\.import\.unsupported'/)
    expect(notice).toMatch(/'too-large': 'canvas\.import\.tooLarge'/)
    expect(notice).toMatch(/empty: 'canvas\.import\.empty'/)
    expect(notice).toMatch(/tone: 'warn'/)
  })
})

describe('文案与 wire', () => {
  it('五个键中英都齐（少一条就是界面上冒出一个键名）', () => {
    const keys: CanvasKey[] = [
      'canvas.action.import',
      'canvas.import.done',
      'canvas.import.replaced',
      'canvas.import.unsupported',
      'canvas.import.tooLarge',
      'canvas.import.empty',
    ]
    for (const key of keys) {
      expect(zh[key], `${key} 缺中文`).toBeTruthy()
      expect(en[key], `${key} 缺英文`).toBeTruthy()
    }
  })

  it('上限那句话里的数字来自常量，不是又写一遍 16', () => {
    expect(NOTICE).toMatch(/Math\.round\(IMPORT_MAX_BYTES \/ 1024 \/ 1024\)/)
    expect(zh['canvas.import.tooLarge']).toContain('{limit}')
    expect(en['canvas.import.tooLarge']).toContain('{limit}')
  })

  it('四处同名：bridge 的转发、remote 的成员与调用键、typert 的成员、contract 的 id', () => {
    const bridge = code(read('../../../../src/client/wire/bridge.ts'))
    expect(bridge).toMatch(/importArtifact\(projectId: string, cardId: string, name: string, content: string\): Promise<BoardCard>/)
    expect(bridge).toMatch(/this\.card\.importArtifact\(projectId, cardId, name, content, this\.signal\)/)
    const remote = code(read('../../../../src/client/wire/remote.ts'))
    expect(remote).toMatch(/importArtifact\(projectId: string, cardId: string, name: string, content: string, signal\?: AbortSignal\)/)
    expect(remote).toMatch(/'card\/importArtifact': CardFace\['importArtifact'\]/)
    expect(code(read('../../../../src/typert.ts'))).toMatch(/member\('importArtifact'/)
    expect(code(read('../../../../src/contract.ts'))).toMatch(/id: 'dsh-canvas-flow#card\/import_artifact'/)
  })
})
