/**
 * dsh-canvas — one card on the board.
 *
 * 200×140 的基准尺寸，图片与视频按两倍坐（`core/canvas/card-size.ts` 是唯一真源，宿主
 * 排位与浏览器画图读的是同一个函数）。两张卡面：名字行与产物预览，卡上没有别的东西。
 * There is no status dot — the card says "a turn is running" with motion, not with a
 * lamp: the sweep below is the whole signal, and it is the only one.
 *
 * The name band (F1.12) is the card's own name — the user's, or its artifact's —
 * and it is editable in place: press and release on it without dragging, and the
 * line becomes an input. The artifact moves with the name, so what the band shows
 * and where the file lives stay one thing; that decision is the host's
 * (`core/canvas/card-name.ts`), and this component only hands over the word.
 *
 * The tile owns exactly two pieces of local state, the drag offset and whether
 * the name is being edited, so neither a drag nor a rename round-trips through
 * the host until it is finished: the position is committed once, on release, and
 * the name once, on Enter or on blur.
 *
 * While the card's session runs, the tile adds one child: `.dsh-canvas-shimmer`,
 * a skewed light band sweeping across the card (see `styles.ts`). It is a layer
 * of its own rather than the card's `::after`, because the card cannot clip its
 * overflow — its ports hang outside its border. The content underneath stays
 * where it is: the sweep is the whole signal, and what the preview shows is
 * still the last artifact that actually exists.
 */import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardCard, CardSummary, Point } from '../../../types.ts'
import type { CardState } from '../../wire/session-read.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import type { Translate } from '../../ui/locales.ts'
import { renderMarkdown } from '../../artifact/viewers/markdown.ts'
import { useDesignShot, useWebAppHtml } from './card-shot.ts'
import { useAspectReport, useMediaAsset } from './card-media.ts'
import { mediaFaceOf, type MediaAsset, type MediaFace } from './media-face.ts'
import { sizeOfCard } from '../../../core/canvas/card/card-size.ts'

/** Props of one board tile. */
export interface CardTileProps {
  card: BoardCard
  /** Derived from the card's session and its file (see `session-read.ts`). */
  state: CardState
  /** The artifact's digest, once read; the preview shows its outline. */
  summary: CardSummary | undefined
  /** 画布所在项目：设计截图与应用迷你帧都要拿它读产物。 */
  projectId: string
  bridge: CanvasBridge
  selected: boolean
  /** Which port the user is currently dragging a source edge from, if any. */
  connecting: 'in' | 'out' | undefined
  /** 连线拖拽悬停在卡片上：碰撞高亮，放手就在它身上结关联。 */
  linkOver: boolean
  /** Board zoom, so a pointer delta in screen px becomes a canvas delta. */
  zoom: number
  t: Translate
  onSelect: (cardId: string) => void
  /** Commit a drag. */
  onMove: (cardId: string, position: Point) => void
  /** Called while a drag is in flight so the source edges can follow the card; `undefined` ends it. */
  onDragMove: (cardId: string, position: Point | undefined) => void
  /** Start dragging a source edge from one of this card's ports. */
  onConnectStart: (cardId: string, side: 'in' | 'out', at: { clientX: number; clientY: number }) => void
  /** Finish a source edge on one of this card's ports. */
  onConnectDrop: (cardId: string, side: 'in' | 'out') => void
  /** Double-click: select the card and open its artifact fullscreen (F3.8). */
  onActivate: (cardId: string) => void
  /** Commit a new name (F1.12). The host settles the path and answers with the card. */
  onRename: (cardId: string, name: string) => void
}

/** Up to four preview lines: the artifact's outline, or a fallback. */
function previewLines(summary: CardSummary | undefined, fallback: string): string[] {
  if (summary === undefined) return [fallback]
  const outline = summary.outline.filter((line) => line.trim() !== '').slice(0, 4)
  if (outline.length > 0) return outline
  const prose = summary.summary.split(/\r?\n/).filter((line) => line.trim() !== '')
  return prose.length > 0 ? prose.slice(0, 4) : [fallback]
}

/**
 * 补齐被截断的 markdown 围栏。
 * `head` 是按字符数硬切的，可能正好落在一段未闭合的 ``` 围栏中间；不补的话，
 * 渲染器把围栏记号当正文画出来。围栏记号出现奇数次＝有一段没闭合，补一个收尾。
 */
function balancedFences(head: string): string {
  const marks = head.match(/```/g)?.length ?? 0
  return marks % 2 === 1 ? `${head}\n\`\`\`` : head
}

/** 应用卡的迷你帧：入口页跑在一个缩到一半的沙箱 iframe 里，不接指针、不进 Tab 序。 */
function FramePreview({ html, title }: { html: string; title: string }) {
  return (
    <div className="dsh-canvas-card-frame">
      <iframe
        title={title}
        // 与全屏预览同一副锁（opaque origin + 放行弹窗）：全屏路径验证过的组合，
        // 迷你帧不发明自己的沙箱规则。
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        srcDoc={html}
        tabIndex={-1}
      />
    </div>
  )
}

/**
 * 媒体卡的面：产物自己（图片 / 视频 / 音频）。
 *
 * 画哪个元素、谁吃指针这两条判断都在 `media-face.ts` 里（那里也写了理由）；这里只负责
 * 把元素摆上去，以及把「没有东西可画」翻成一句人话——与全屏预览用同一批文案，免得
 * 同一件事在两个地方说成两句不同的话。
 */
function MediaPreview({ asset, face, t }: { asset: MediaAsset; face: MediaFace; t: Translate }) {
  if (asset.status === 'absent') return <div className="dsh-canvas-card-note">{t('canvas.viewer.absent')}</div>
  if (asset.status === 'too-large') return <div className="dsh-canvas-card-note">{t('canvas.viewer.tooLarge')}</div>
  if (asset.status !== 'ready') return null

  // 有控件的元素自己吃掉 pointerdown（不吃的话按播放键会变成拖卡片，见 media-face.ts）；
  // 图片没有控件，于是不挂这一段——它的指针照旧留给卡片：点＝选中、拖＝拖卡。
  const hold = face.controls ? { onPointerDown: (event: React.PointerEvent) => event.stopPropagation() } : {}

  if (face.element === 'audio') {
    return (
      <div className="dsh-canvas-card-media-audio">
        <audio src={asset.dataUrl} controls {...hold} />
      </div>
    )
  }
  if (face.element === 'video') return <video className="dsh-canvas-card-media" src={asset.dataUrl} controls {...hold} />
  return <img className="dsh-canvas-card-media" src={asset.dataUrl} alt="" draggable={false} />
}

/** Render one artifact card. */
export function CardTile(props: CardTileProps) {
  const { card, state, summary, projectId, bridge, selected, connecting, linkOver, zoom, t, onSelect, onMove, onDragMove, onConnectStart, onConnectDrop, onActivate, onRename } = props
  const [offset, setOffset] = useState<Point | undefined>(undefined)
  const drag = useRef<{ x: number; y: number; moved: boolean; name: boolean } | undefined>(undefined)

  /**
   * 名字面上的就地改名（F1.12）。
   *
   * 触发方式是**在名字上抬手而没有拖动**，不是 `onClick`：卡片的拖拽用指针捕获
   * 起手（`setPointerCapture`），随后的 click 会被重定向到卡片本身，而「按下名字
   * 再挪两下」本来就是拖卡片——同一个手势只能有一个意思。于是判据落在既有那条
   * `moved` 上：没动过 ＝ 点，动过 ＝ 拖。名字因此仍然是**可拖的把柄**（整条上沿
   * 都能拿来拖卡片），只有「按下即抬手」才切进输入框。
   *
   * 输入框是**非受控**的：值只在提交那一刻读。这样粗体光标、IME 組字与全选都由
   * 浏览器自己管，而 React 不必每敲一个字就重绘整张卡（卡上还挂着预览与流光）。
   */
  const [renaming, setRenaming] = useState(false)
  const nameRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /**
   * Esc 已经表过态：随后那次 blur 不许再提交一次。
   *
   * 它必须**在每次切进输入框时清掉**：按 Esc 之后输入框是被卸载的，浏览器不会
   * 再补一次 blur 来清这枚标记，留着的话下一次改名提交会被上一轮的撤回吞掉。
   */
  const cancelled = useRef(false)

  useEffect(() => {
    if (!renaming) return
    const input = inputRef.current
    if (input === null) return
    input.focus()
    // 全选而不是把光标放在行尾：改名多半是整句替换，而这张卡就 200px 宽。
    input.select()
  }, [renaming])

  const commitRename = (value: string) => {
    setRenaming(false)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const wanted = value.trim()
    // 没改，或者改成了空的：什么都不发生（空名字由 host 拒绝，不必来回一趟）。
    if (wanted === '' || wanted === card.name) return
    onRename(card.id, wanted)
  }

  const position = offset ?? card.position
  const lines = previewLines(summary, card.kindLabel)
  // 占位读 `core/canvas/card-size.ts`：量过产物比例就按那个比例坐（v1.80 / F3.11），
  // 没量过就是默认的 16:9（v1.79 起所有形态同一档）。**这是唯一的尺寸来源**，卡里没有
  // 别处再写一遍宽高——卡头、名字、预览的内边距与字号都不动。
  const size = sizeOfCard(card)

  // ── 预览按 kind 分派 ────────────────────────────────────────────────────────
  // markdown 渲染原文头部（host 已按 PREVIEW_HEAD_CHARS 截好）；**媒体画产物自己**
  // （图片就是那张图，视频与音频就是它们的原生播放器——字节不是文本，大纲行对它们是空的，
  // 只画大纲等于一张图都没有）；设计卡画离屏截图；应用卡装迷你帧；其余 kind 与一切还没
  // 读到的时刻，照旧显示大纲行。
  // 三个取材 hook 必须无条件调用（React 规则），闸都收在 enabled 里。
  //
  // kind 以盘面证据（summary）为准：旧板上的记录可能盖着归并前的章（site/webapp），
  // 重探出来的 kind 才是当前的类型表认的那一个（app）。
  const kind = summary?.kind ?? card.kind
  const mdHtml = useMemo(
    () => (kind === 'markdown' && summary !== undefined && summary.head !== '' ? renderMarkdown(balancedFences(summary.head)) : ''),
    [kind, summary],
  )
  const mediaFace = mediaFaceOf(kind)
  const media = useMediaAsset(bridge, projectId, card.id, summary?.bytes ?? 0, mediaFace !== undefined && summary !== undefined)
  // 产物一加载完就把它的真实比例报回宿主（F3.11）：下一份板面快照里 `card.aspect` 就有了，
  // 这张卡于是按产物自己的形状坐。只在量到的比例与记录不同时才写。
  useAspectReport(bridge, projectId, card.id, media, mediaFace, card.aspect)
  const designShot = useDesignShot(bridge, projectId, card.id, summary?.bytes ?? 0, kind === 'design' && summary !== undefined)
  const frameHtml = useWebAppHtml(
    bridge,
    projectId,
    card.id,
    summary?.bytes ?? 0,
    kind === 'app' && summary !== undefined,
  )

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    onSelect(card.id)
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      // 命中的是不是名字那一条：抬手时据它决定「点」落在哪儿。
      name: nameRef.current !== null && event.target instanceof Node && nameRef.current.contains(event.target),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current
    if (started === undefined) return
    const dx = (event.clientX - started.x) / zoom
    const dy = (event.clientY - started.y) / zoom
    if (!started.moved && Math.abs(dx) + Math.abs(dy) < 3) return
    started.moved = true
    const next = { x: card.position.x + dx, y: card.position.y + dy }
    setOffset(next)
    onDragMove(card.id, next)
  }

  const pointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const started = drag.current
    drag.current = undefined
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (started === undefined || !started.moved) {
      setOffset(undefined)
      // 在名字上「按下即抬手」＝ 要改名。卡片别处的一抬手依旧什么都不做：
      // 选中在按下时就发生了，抬手只负责收尾。
      if (started?.name === true) {
        // 先把上一轮的撤回记录清掉（见 cancelled 的注释），再切进输入框。
        cancelled.current = false
        setRenaming(true)
      }
      return
    }
    const landed = offset
    setOffset(undefined)
    onDragMove(card.id, undefined)
    if (landed !== undefined) onMove(card.id, { x: Math.round(landed.x), y: Math.round(landed.y) })
  }

  const className = ['dsh-canvas-card']
  if (selected) className.push('is-selected')
  // 碰撞高亮与选中是两回事：一个说「线会结到我身上」，一个说「面板跟着我」。
  if (linkOver) className.push('is-link-over')
  if (state === 'missing') className.push('is-absent')
  // 会话 running = 这张卡片正在产出内容，卡面亮起流光（见 styles.ts 的 is-working）。
  // 不另设本地的「已发送」标志：会话状态就是唯一真源，光在扫与模型在跑始终同义。
  if (state === 'running') className.push('is-working')

  return (
    <div
      className={className.join(' ')}
      style={{ left: `${position.x}px`, top: `${position.y}px`, width: `${size.width}px`, height: `${size.height}px` }}
      aria-busy={state === 'running'}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onDoubleClick={() => onActivate(card.id)}
      role="button"
      tabIndex={0}
      title={card.file}
    >
      {/* 流光层画在内容之前：它是绝对定位的，因此盖在名字与预览之上（那道光是「正在
          跑」的整句话），而同样绝对定位、排在他后面的两个端口仍压在最上面。 */}
      {state === 'running' ? <span className="dsh-canvas-shimmer" aria-hidden="true" /> : null}

      <div className="dsh-canvas-card-head">
        {renaming ? (
          <input
            className="dsh-canvas-card-namefield"
            ref={inputRef}
            defaultValue={card.name}
            aria-label={t('canvas.card.rename')}
            spellCheck={false}
            // 输入框里的指针、双击与按键一律留在自己这里：卡片会拖、双击会开全屏，
            // 而这里正在写字。
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename(event.currentTarget.value)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelled.current = true
                setRenaming(false)
              }
            }}
            onBlur={(event) => commitRename(event.currentTarget.value)}
          />
        ) : (
          <div className="dsh-canvas-card-name" ref={nameRef} title={`${card.name} · ${card.file}`}>
            {card.name}
          </div>
        )}
      </div>

      <div className="dsh-canvas-card-preview">
        {mdHtml !== '' ? (
          // 文本卡片：最新原文的头部（host 截取），渲染成 markdown——大纲行是目录，
          // 这才是文章本身。
          <div className="dsh-canvas-card-md" dangerouslySetInnerHTML={{ __html: mdHtml }} />
        ) : media !== undefined && mediaFace !== undefined && media.status !== 'empty' ? (
          // 媒体卡片：产物自己。`empty` 那一路退回下面的大纲行——「这张卡还没有东西」
          // 本来就该是那个样子，而不是一条说不清的提示。
          <MediaPreview asset={media} face={mediaFace} t={t} />
        ) : kind === 'design' && designShot !== undefined ? (
          // 设计卡片：场景图离屏渲染成的截图。
          <img className="dsh-canvas-card-shot" src={designShot} alt="" draggable={false} />
        ) : kind === 'app' && frameHtml !== undefined ? (
          // 应用卡片：跑起来的入口页缩比帧——真帧而非截图，shadow root 里的内容都在。
          <FramePreview html={frameHtml} title={card.name} />
        ) : (
          lines.map((line, index) => (
            <div className="dsh-canvas-card-preview-line" key={`${index}:${line}`}>
              {line}
            </div>
          ))
        )}
      </div>

      {/* Ports: `out` declares this card as material, `in` declares it as the consumer. */}
      <span
        className="dsh-canvas-port"
        data-side="out"
        role="button"
        title={t('canvas.action.link')}
        onPointerDown={(event) => {
          event.stopPropagation()
          onConnectStart(card.id, 'out', event)
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          onConnectDrop(card.id, 'out')
        }}
      >
        +
      </span>
      <span
        className="dsh-canvas-port"
        data-side="in"
        role="button"
        title={t('canvas.action.link')}
        onPointerUp={(event) => {
          event.stopPropagation()
          onConnectDrop(card.id, 'in')
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          onConnectStart(card.id, 'in', event)
        }}
      >
        {connecting === undefined ? '+' : '→'}
      </span>
    </div>
  )
}
