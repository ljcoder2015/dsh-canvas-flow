/**
 * The fullscreen artifact view (F3.8): the pure decisions the viewers, the
 * registry and the host payload reader are made of. The React components
 * themselves are view; what can drift silently and break a board is the kind →
 * viewer mapping, the kind fact behind the editor, the markdown escaping and
 * the delimited parsing, and those are pinned here — the modal's mode group is
 * pinned by its arrow-key step function for the same reason: the keys are the
 * part a reader cannot see in a screenshot.
 *
 * 一个 spec 对着一族模块（`registry.ts` / `viewers/*` / `editing/*` / `chrome-stack.ts`）
 * 而不是一个文件：这些都是那个 1394 行的 `artifact-view.tsx` 拆出来的纯判断，而它们该被
 * 钉住的理由相同——坏掉的时候不报错，只是画错。
 */
import { describe, expect, it } from 'vitest'
import { BUILTIN_KINDS, DIRECT_TEXT_KINDS, HTML_KINDS, detectKind, isDirectTextKind } from '../../../src/core/artifact/kind/kind-registry.ts'
import { VIEW_TEXT_CAP, mediaMimeOf } from '../../../src/core/artifact/io/artifact-io.ts'
import { artifactViewSchema } from '../../../src/contract.ts'
import { VIEWER_REGISTRY, viewerIdFor } from '../../../src/client/artifact/registry.ts'
import { claimFirst } from '../../../src/client/artifact/chrome-stack.ts'
import { writablePayload, needsBlankText } from '../../../src/client/artifact/editing/writable.ts'
import { seedBlankText } from '../../../src/client/artifact/editing/seed-blank.ts'
import {
  AUTOSAVE_BACKOFF_CAP_MS,
  AUTOSAVE_BACKOFF_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AUTOSAVE_SETTLE_MS,
  autosaveDelay,
  autosaveRetryDelay,
  writeFailureShape,
} from '../../../src/client/artifact/editing/autosave.ts'
import { modeAfterKey } from '../../../src/client/artifact/editing/mode.ts'
import { renderMarkdown } from '../../../src/client/artifact/viewers/markdown.ts'
import { parseDelimited } from '../../../src/client/artifact/viewers/delimited.ts'

describe('kind → viewer mapping', () => {
  it('sends each content kind to its own viewer', () => {
    expect(viewerIdFor('markdown')).toBe('markdown')
    expect(viewerIdFor('image')).toBe('image')
    expect(viewerIdFor('app')).toBe('deck')
    expect(viewerIdFor('data')).toBe('data')
    expect(viewerIdFor('video')).toBe('video')
  })

  it('is total: an unknown kind still gets a viewer, not a blank modal', () => {
    expect(viewerIdFor('file')).toBe('text')
    expect(viewerIdFor('folder')).toBe('text')
    expect(viewerIdFor('something-new')).toBe('text')
  })
})

describe('the viewer registry', () => {
  it('has exactly one fallback, and it is the text viewer', () => {
    // 兜底是标出来的，不是「排在最后」——顺序是看不见的约定，注册表重排一次就会把
    // 「其余一切归我」那条挪到前面，静默截走每个 kind。这条判据让那种改动当场变红。
    const fallbacks = VIEWER_REGISTRY.filter((entry) => entry.fallback === true)
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]?.id).toBe('text')
  })

  it('gives every viewer its own id', () => {
    const ids = VIEWER_REGISTRY.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('leaves no built-in kind without a viewer', () => {
    // 全性：任何 kind 都有答案，所以一张卡离「弹窗空白」永远差着一条注册项的距离。
    for (const entry of BUILTIN_KINDS) expect(viewerIdFor(entry.id)).toBeTruthy()
  })

  it('spreads the HTML family from the host kind list rather than restating it', () => {
    // 「HTML 页面」这份清单只有一份（宿主的 HTML_KINDS）。从前 deck 那两条判据各抄了
    // 一份，而漏掉一个 kind 的下场就是某天某个 HTML 产物丢了它的样式表。这里钉住两边
    // 同源：宿主那份怎么改，预览这边自动跟着有。
    const deck = VIEWER_REGISTRY.find((entry) => entry.id === 'deck')
    expect(deck).toBeDefined()
    for (const kind of HTML_KINDS) expect(deck?.claims(kind)).toBe(true)
  })
})

describe('in-place text editing', () => {
  it('offers the editor exactly where the artifact is its own text', () => {
    // 「产物就是它自己的文字」这份清单也只有一份，在宿主的 kind 表上（`DIRECT_TEXT_KINDS`）：
    // 控制带在开弹窗**之前**要它（手里只有一个 kind），弹窗里的编辑面要它（手里是整份
    // payload），两边读同一份，所以不可能各说各话。
    expect(isDirectTextKind('markdown')).toBe(true)
    // 兜底 kind 是 `file`。这条判据从前是 `isEditableText('text')` —— 而 `'text'` 是
    // **预览器 id**、不是任何 kind（兜底 kind 叫 `file`），于是「纯文本文件能就地编辑」
    // 那段判定从未生效过：`.txt` / `.js` 这类文件在弹窗里只能看，卡片控制带上的「手动
    // 输入」也对它们隐身。补 `'file'` 之后，这条判据测的是真会出现的输入，而不是一个
    // 不可能出现的字符串。
    expect(isDirectTextKind('file')).toBe(true)
  })

  it('keeps the editor away from kinds that would be overwritten whole', () => {
    // 数据看的是表格、Deck 看的是渲染结果、图片与视频根本不是文字：编辑器整篇写回，
    // 这些形态给一枚编辑钮就是把文件改成文本。目录同样不行——它的 payload 不是文本。
    for (const kind of ['data', 'app', 'image', 'video', 'folder', '']) {
      expect(isDirectTextKind(kind)).toBe(false)
    }
    // 预览器 id 不是 kind：兜底那条的 id 恰好叫 `text`，别把它当 kind 用。
    expect(isDirectTextKind('text')).toBe(false)
  })

  it('keeps that list to kinds the host actually defines', () => {
    // 清单里漏一个、或写了个不存在的 id，都不会报错：只是控制带那枚按钮与弹窗里的编辑面
    // 一起消失（后者更糟——整篇写回会写到一个谁也不认识的 kind 上）。所以钉住它与 kind 表同源。
    expect(DIRECT_TEXT_KINDS.length).toBeGreaterThan(0)
    for (const kind of DIRECT_TEXT_KINDS) {
      expect(BUILTIN_KINDS.some((entry) => entry.id === kind)).toBe(true)
    }
  })

  it('refuses to open the editor on a payload that was only half read', () => {
    // kind 只说得出「这类产物是它自己的文字」，还有一半在 payload 里：读了一半的文件
    // 绝不能写——写回去的会是「我们读到的那半」。
    const whole = { kind: 'markdown', present: true, truncated: false }
    expect(writablePayload(whole)).toBe(true)
    expect(writablePayload({ ...whole, truncated: true })).toBe(false)
    // 文件不在也不是「空文件」：空文件是存在的。
    expect(writablePayload({ ...whole, present: false })).toBe(false)
    // 另一半与上面那组同源。
    expect(writablePayload({ kind: 'data', present: true, truncated: false })).toBe(false)
    expect(writablePayload({ kind: 'folder', present: true, truncated: false })).toBe(false)
  })

  it('classifies a file that is not there yet from its name alone', () => {
    // 空座位（F1.11）上没有可读的东西，`view.kind` 也照样有答案——按路径的扩展名。
    // 下面那条判据就靠它，不然「手动输入」还是会恰好在没东西可写的时候隐身。
    const absent = { path: '文本1.md', basename: '文本1.md', extension: 'md', directory: false, head: '', children: [] }
    expect(detectKind(absent)).toBe('markdown')
    expect(detectKind({ ...absent, path: 'notes.txt', basename: 'notes.txt', extension: 'txt' })).toBe('file')
    expect(detectKind({ ...absent, path: 'photo.png', basename: 'photo.png', extension: 'png' })).toBe('image')
  })
})

describe('「手动输入」落到还没有产物的文本卡上（F3.12 × F3.14）', () => {
  it('writes the first blank file, and only for the door that means "I want to write"', () => {
    // 用户的原话：文本卡片点「手动输入」时，如果还没有创建文本，就先建一个空白文本文件
    // 再打开编辑。这枚按钮的意思是「我要写字」，而座位上还没有产物（F1.11）恰恰是这条路
    // 的起点——缺了这一条，它点下去只会得到一句「产物不存在」。
    const seated = { kind: 'markdown', present: false }
    expect(needsBlankText(seated, true)).toBe(true)
    // 纯文本兜底 kind 也在「产物就是它自己的文字」那一族里。
    expect(needsBlankText({ kind: 'file', present: false }, true)).toBe(true)
  })

  it('stays out of the way of the three cases it must not touch', () => {
    const seated = { kind: 'markdown', present: false }
    // 看一眼预览不该把文件写出来——那是把「读」变成「写」。
    expect(needsBlankText(seated, false)).toBe(false)
    // 空文件是**在**的：那是用户自己清空的结果，不是我们要补的缺。
    expect(needsBlankText({ kind: 'markdown', present: true }, true)).toBe(false)
    // 给别的形态补一份空文本就是把那个文件改成文本。
    for (const kind of ['data', 'app', 'image', 'video', 'folder', '']) {
      expect(needsBlankText({ kind, present: false }, true)).toBe(false)
    }
  })

  it('creates the file first and reads the result back, in that order', async () => {
    // 次序是那三行的全部内容：先有文件才有「产物」，而编辑面吃的是**回读回来的**那一份
    // ——不是我们以为自己写了什么。写在不该写的位置、或者读在写之前，界面上都只是「没反应」。
    const calls: string[] = []
    const fresh = { cardId: 'seat', file: '文本1.md', name: '', kind: 'markdown', present: true, text: '', dataUrl: '', truncated: false, bytes: 0, updatedAt: 1 }
    const wire = {
      writeText: async (projectId: string, cardId: string, content: string) => {
        calls.push(`write ${projectId}/${cardId} ${JSON.stringify(content)}`)
        return {}
      },
      readArtifact: async (projectId: string, cardId: string) => {
        calls.push(`read ${projectId}/${cardId}`)
        return fresh
      },
    }
    const view = await seedBlankText(wire, 'flow-test', 'seat')
    expect(calls).toEqual(['write flow-test/seat ""', 'read flow-test/seat'])
    expect(view).toBe(fresh)
  })

  it('lets a refused write through, rather than pretending the file is there', async () => {
    // 写不进去（只读模式、沙箱拒绝）要说写不进去：退回「产物不存在」会让人以为是自己点错了。
    const wire = {
      writeText: async () => {
        throw new Error('EPERM: operation not permitted')
      },
      readArtifact: async () => {
        throw new Error('unreachable')
      },
    }
    await expect(seedBlankText(wire, 'flow-test', 'seat')).rejects.toThrow('EPERM')
  })
})

describe('the element picker door (F3.14)', () => {
  it('belongs to the one viewer that draws a page frame', () => {
    // 元素选择要往页面里注入探针、要接页面的回话，所以它只可能长在**画帧的那个预览器**上。
    // 从前这里问的是注册表里的 `pickableFor(kind)`——一条能力声明；现在没有声明了，而是
    // 「帧就是它画的」：认领 HTML 家族的那一条，也正是唯一有元素选择钮的那一条。所以这条
    // 判据改成钉这件事——HTML 家族有且只有一个主人（兜底那条认领一切，但它不是主人：
    // 它只是「都没人认领时归我」，而 HTML 家族有人认领）。
    const owners = VIEWER_REGISTRY.filter(
      (entry) => entry.fallback !== true && HTML_KINDS.some((kind) => entry.claims(kind)),
    )
    expect(owners.map((entry) => entry.id)).toEqual(['deck'])
  })

  it('stays off the kinds that have nothing to click', () => {
    for (const kind of ['markdown', 'data', 'image', 'video', 'folder']) {
      expect(viewerIdFor(kind)).not.toBe('deck')
    }
  })
})

describe('the chrome stacks (element picker / unsaved draft)', () => {
  it('asks the newest claimant first', () => {
    // 后来登记的总在最上面那一层：Esc 要退的是「刚打开的那样东西」。这条顺序错了不会报错，
    // 只是按下 Esc 时做的是另一件事，所以钉住。
    const asked: string[] = []
    const claimed = claimFirst([
      () => {
        asked.push('先登记的')
        return false
      },
      () => {
        asked.push('后登记的')
        return true
      },
    ])
    expect(claimed).toBe(true)
    expect(asked).toEqual(['后登记的'])
  })

  it('stops at the first claimant instead of polling everyone', () => {
    // 认领是要**改状态**的（关掉一个模式、问出一句确认），所以不能问完所有人再决定。
    let asked = 0
    const claimed = claimFirst([
      () => {
        asked += 1
        return true
      },
      () => {
        asked += 1
        return true
      },
    ])
    expect(claimed).toBe(true)
    expect(asked).toBe(1)
  })

  it('hands the decision back to the shell when nobody claims', () => {
    // 空摞＝没有模式、没有那一笔选择、没有确认条 ⇒ Esc 该关掉预览、× 该关掉弹窗。
    expect(claimFirst([])).toBe(false)
    expect(claimFirst([() => false, () => false])).toBe(false)
  })
})

describe('preview / edit mode group', () => {
  it('selects the neighbour on an arrow, the way a radio group does', () => {
    // 单选组的方向键是**选择**，不是移动光标：按右键就该切到右边那一项。
    expect(modeAfterKey('preview', 'ArrowRight')).toBe('edit')
    expect(modeAfterKey('edit', 'ArrowLeft')).toBe('preview')
    // 竖着按也认——两项的一组没有「哪条轴才对」的问题。
    expect(modeAfterKey('preview', 'ArrowDown')).toBe('edit')
    expect(modeAfterKey('edit', 'ArrowUp')).toBe('preview')
  })

  it('declines, rather than wraps, when the arrow points off the end', () => {
    // 到头了要交回事件（null），不能吞掉也不能绕回另一头：绕回去等于
    // 按左键又切到编辑面，用户会以为键坏了。
    expect(modeAfterKey('preview', 'ArrowLeft')).toBeNull()
    expect(modeAfterKey('preview', 'ArrowUp')).toBeNull()
    expect(modeAfterKey('edit', 'ArrowRight')).toBeNull()
    expect(modeAfterKey('edit', 'ArrowDown')).toBeNull()
  })

  it('leaves every other key to the rest of the modal', () => {
    // ⌘S、Esc、字键都不是这组的：这里返回 null，事件继续往上走。
    for (const key of ['s', 'Escape', 'Enter', ' ', 'Tab', 'Home', 'PageDown']) {
      expect(modeAfterKey('preview', key)).toBeNull()
      expect(modeAfterKey('edit', key)).toBeNull()
    }
  })
})

describe('autosave pacing', () => {
  it('waits the quiet period for a fresh keystroke', () => {
    // 刚落键：等一整个停手期，一个字一个字打不会每次都往盘上写。
    expect(autosaveDelay(0)).toBe(AUTOSAVE_SETTLE_MS)
    expect(autosaveDelay(400)).toBe(AUTOSAVE_SETTLE_MS)
  })

  it('shortens the wait as the pending buffer ages, and writes at the ceiling', () => {
    // 一直不停手时不能永远等下去：从「停手期」线性压到 0，到上限就立刻写。
    expect(autosaveDelay(AUTOSAVE_MAX_WAIT_MS - AUTOSAVE_SETTLE_MS)).toBe(AUTOSAVE_SETTLE_MS)
    expect(autosaveDelay(AUTOSAVE_MAX_WAIT_MS - 200)).toBe(200)
    expect(autosaveDelay(AUTOSAVE_MAX_WAIT_MS)).toBe(0)
    expect(autosaveDelay(AUTOSAVE_MAX_WAIT_MS + 5000)).toBe(0)
  })

  it('never exceeds the ceiling and never goes negative', () => {
    for (const elapsed of [0, 1, 799, 800, 4200, 5000, 10 ** 9]) {
      const delay = autosaveDelay(elapsed)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(AUTOSAVE_SETTLE_MS)
    }
  })

  it('falls back to the settle period on a nonsense clock, rather than to no wait', () => {
    // NaN / 负数来自时钟异常：这时要退到「等一等」，不能退到「立刻写」。
    expect(autosaveDelay(Number.NaN)).toBe(AUTOSAVE_SETTLE_MS)
    expect(autosaveDelay(-1)).toBe(AUTOSAVE_SETTLE_MS)
    expect(autosaveDelay(Number.POSITIVE_INFINITY)).toBe(AUTOSAVE_SETTLE_MS)
  })

  it('keeps a settle period that fits inside the ceiling', () => {
    // 停手期就是上限本身时，节流等于纯 debounce——写死这两个数之前先卡住关系。
    expect(AUTOSAVE_SETTLE_MS).toBeLessThanOrEqual(AUTOSAVE_MAX_WAIT_MS)
  })
})

describe('autosave backoff after a refused write', () => {
  it('holds off by a doubling wait, so a refusing wire is not written every 800ms', () => {
    expect(autosaveRetryDelay(1)).toBe(AUTOSAVE_BACKOFF_MS)
    expect(autosaveRetryDelay(2)).toBe(AUTOSAVE_BACKOFF_MS * 2)
    expect(autosaveRetryDelay(3)).toBe(AUTOSAVE_BACKOFF_MS * 4)
    expect(autosaveRetryDelay(4)).toBe(AUTOSAVE_BACKOFF_MS * 8)
  })

  it('never waits past the ceiling, however long the failures run', () => {
    for (const failures of [5, 6, 9, 40, 10 ** 6]) {
      expect(autosaveRetryDelay(failures)).toBeLessThanOrEqual(AUTOSAVE_BACKOFF_CAP_MS)
    }
    expect(autosaveRetryDelay(5)).toBe(AUTOSAVE_BACKOFF_CAP_MS)
  })

  it('has nothing to wait for before the first failure', () => {
    expect(autosaveRetryDelay(0)).toBe(0)
    expect(autosaveRetryDelay(-1)).toBe(0)
    expect(autosaveRetryDelay(Number.NaN)).toBe(0)
  })

  it('keeps the first backoff longer than a settle, or it is not a backoff', () => {
    expect(AUTOSAVE_BACKOFF_MS).toBeGreaterThan(AUTOSAVE_SETTLE_MS)
    expect(AUTOSAVE_BACKOFF_CAP_MS).toBeGreaterThanOrEqual(AUTOSAVE_BACKOFF_MS)
  })
})

describe('telling a refused write from a blip', () => {
  it('reads the exact refusal this feature was written for as blocked', () => {
    // 用户报的原话：宿主经私有暂存目录原子替换，rename 被拒 → 这次写入不会因为
    // 重试而成功，只会每次留下一份暂存文件。
    const reported =
      "write failed (EPERM: operation not permitted, rename '/Users/admin/Project/flow-test/.untitled-2.md.4534.ded0e5f5-ae74-4b56-8e4a-a1ebfe1101b7.tmpdir/untitled-2.md.tmp' -> '/Users/admin/Project/flow-test/untitled-2.md') and temp cleanup failed (EPERM: operation not permitted, unlink '/Users/admin/Project/flow-test/.untitled-2.md.4534.ded0e5f5-ae74-4b56-8e4a-a1ebfe1101b7.tmpdir/untitled-2.md.tmp')"
    expect(writeFailureShape(reported)).toBe('blocked')
  })

  it('counts every way a filesystem says "not this time" as blocked', () => {
    expect(writeFailureShape('write failed (EPERM: operation not permitted, rename a -> b)')).toBe('blocked')
    expect(writeFailureShape('open failed (EACCES: permission denied)')).toBe('blocked')
    expect(writeFailureShape('write failed (EROFS: read-only file system)')).toBe('blocked')
    expect(writeFailureShape('cannot write "a.png": not a regular file')).toBe('blocked')
  })

  it('leaves a blip on the retry path', () => {
    // 这几条值得再试：会话重启、请求超时、文件刚被改过（无守卫的整篇写回会成功）。
    expect(writeFailureShape('gateway timeout')).toBe('transient')
    expect(writeFailureShape('ECONNRESET')).toBe('transient')
    expect(writeFailureShape('canvas: card/stale-version')).toBe('transient')
    expect(writeFailureShape('未知错误')).toBe('transient')
    expect(writeFailureShape('')).toBe('transient')
  })
})

describe('binary media typing', () => {
  it('names a MIME type for every extension the image and video kinds cover', () => {
    expect(mediaMimeOf('png')).toBe('image/png')
    expect(mediaMimeOf('jpg')).toBe('image/jpeg')
    expect(mediaMimeOf('jpeg')).toBe('image/jpeg')
    expect(mediaMimeOf('svg')).toBe('image/svg+xml')
    expect(mediaMimeOf('mp4')).toBe('video/mp4')
    expect(mediaMimeOf('mov')).toBe('video/quicktime')
    expect(mediaMimeOf('webm')).toBe('video/webm')
  })

  it('refuses non-media extensions, so text kinds stay on the text path', () => {
    expect(mediaMimeOf('md')).toBeUndefined()
    expect(mediaMimeOf('csv')).toBeUndefined()
    expect(mediaMimeOf('html')).toBeUndefined()
    expect(mediaMimeOf('')).toBeUndefined()
  })
})

describe('markdown rendering', () => {
  it('escapes artifact markup before building any tag of its own', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
  })

  it('cannot be tricked into forging a fenced-code placeholder', () => {
    const html = renderMarkdown('before\n\u00000\u0000\nafter')
    // The artifact's own placeholder characters are escaped by `inline`, so no
    // stash slot is resolved from content.
    expect(html).toContain('\u00000\u0000')
  })

  it('renders the structural subset the viewer promises', () => {
    const html = renderMarkdown(
      ['# 标题', '', '正文 **加粗** *斜体* `代码`', '', '- 一', '- 二', '', '> 引用', '', '---'].join('\n'),
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<code class="dsh-md-inline">代码</code>')
    expect(html.replace(/\n/g, '')).toContain('<ul class="dsh-md-list"><li>一</li><li>二</li></ul>')
    expect(html).toContain('<blockquote class="dsh-md-quote">引用</blockquote>')
    expect(html).toContain('<hr class="dsh-md-hr">')
  })

  it('keeps fenced code verbatim, unstyled by the inline rules', () => {
    const html = renderMarkdown('```js\nconst a = "<b>";\n```\n')
    expect(html).toContain('<pre class="dsh-md-code"><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>')
    expect(html).not.toContain('<b>')
  })

  it('orders lists after fences correctly and closes them at the end', () => {
    const html = renderMarkdown('1. first\n2. second')
    expect(html.replace(/\n/g, '')).toContain('<ol class="dsh-md-list"><li>first</li><li>second</li></ol>')
  })
})

describe('delimited parsing', () => {
  it('splits plain rows on the delimiter', () => {
    expect(parseDelimited('a,b,c\n1,2,3', ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('keeps commas and escaped quotes inside quoted cells', () => {
    expect(parseDelimited('"a, b","say ""hi""",c', ',')).toEqual([['a, b', 'say "hi"', 'c']])
  })

  it('handles CRLF and a trailing newline without ghost rows', () => {
    expect(parseDelimited('a,b\r\n1,2\r\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('serves tab-delimited bodies too', () => {
    expect(parseDelimited('a\tb', '\t')).toEqual([['a', 'b']])
  })
})

describe('wire payload validation', () => {
  it('accepts a text view and a data-URL view', () => {
    const base = { cardId: 'a.md', file: 'a.md', name: 'a', kind: 'markdown', present: true, truncated: false, bytes: 3, updatedAt: 1 }
    expect(artifactViewSchema.parse({ ...base, text: 'abc', dataUrl: '' }).present).toBe(true)
    expect(artifactViewSchema.parse({ ...base, cardId: 'a.png', kind: 'image', text: '', dataUrl: 'data:image/png;base64,AAAA' }).kind).toBe('image')
  })

  it('accepts the absent state a seated-but-unwritten card answers with', () => {
    const view = artifactViewSchema.parse({
      cardId: 'a.md',
      file: 'a.md',
      // F1.12: a reader that did not know the card sends no name. Empty is the
      // agreed shape for that — the client then falls back to the path — so the
      // empty string has to stay a legal payload, not an error.
      name: '',
      kind: 'markdown',
      present: false,
      text: '',
      dataUrl: '',
      truncated: false,
      bytes: 0,
      updatedAt: 1,
    })
    expect(view.present).toBe(false)
  })

  it('keeps the text cap and the schema cap in agreement', () => {
    // `.readonly()` wraps the object, so the cap is reached through the inner shape.
    const shape = (artifactViewSchema as unknown as { _def: { typeName: string; innerType: { shape: { text: { maxLength?: number | null } } } } })._def
      .innerType
    expect(VIEW_TEXT_CAP).toBeLessThanOrEqual(shape?.shape.text.maxLength ?? Infinity)
  })
})
