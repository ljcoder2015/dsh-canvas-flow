/**
 * dsh-canvas — skeleton2d 卡的 Rigby2D 编辑器宿主（v2.08 改道）。
 *
 * 「编辑」档不再渲染自研的四模式编辑器：这里是**一个 iframe**，里面跑 vendor 进来的
 * Rigby2D 编辑器（`/dsh-canvas/rigby2d-editor/`，构建见 `rigby2d-build.mjs`，fork 差异
 * 见 `vendor/rigby2d/FORK.md`）。iframe 内外只说一种话——`bridge/hostbridge.js` 定义的
 * postMessage 协议：
 *
 * - **打开**：宿主把产物交给桥。两种来路——
 *   - v3 外壳：`rigby.doc`（工作档 JSON）+ `rigby.files`（随档图集），直接开 `.rigby`；
 *   - v1 轻模型：现场用 `dragonBonesPackOf` 烘一份 DragonBones 三件套（骨架 / 图集 /
 *     贴图）交给它——**Rigby2D 原生认 DragonBones 导入**，旧格式的动画无损进编辑器；
 *     用户保存（Ctrl+S）时它写出 `.rigby` 工作档，宿主包回 v3 外壳落盘——迁移就这样
 *     完成，不需要任何一段「格式转换器」。
 * - **保存**：桥的 `finish()` 回传写下的文件；宿主找出 `.rigby` 当 `doc`、其余当
 *   `files`（base64 嵌进外壳——产物仍是一份 JSON，项目里不散落图集文件），沿用保存
 *   四步纪律：写 → 缓存作废 → 回读 adopt → 通知画布。
 * - **脏标记**：桥轮询 `app.dirty()` 回报；宿主把它挂成「未保存」角标——关档丢失改动
 *   这件事要让用户看得见。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { hostBase } from '../../../canvas/project/open-folder.ts'
import { dragonBonesPackOf } from '../../../../core/skeleton2d/dragonbones.ts'
import type { Skeleton2dModel, Skeleton2dRigbyShell } from '../../../../core/skeleton2d/model.ts'
import { invalidateSkeleton2dModel } from './use-skeleton2d.tsx'
import type { ArtifactView } from '../../../../types.ts'
import type { Translate } from '../../../ui/locales.ts'

/** 与 skeleton2d-editor 同一条窄缝（读 + 写两个成员，谁多谁少都不迁就）。 */
interface HostBridge {
  writeText(projectId: string, cardId: string, content: string): Promise<unknown>
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
}

/** 编辑器嵌入包的入口 URL（宿主静态路由，`host/editor-assets.ts`）。 */
export function rigbyEditorUrl(): string {
  return new URL('/dsh-canvas/rigby2d-editor/index.html', hostBase()).href
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function textToB64(text: string): string {
  return bytesToB64(new TextEncoder().encode(text))
}

/** base64 → 文本（随档的 `.rigby` 是 JSON 文本；解码失败如实抛给调用方）。 */
function base64ToText(base64: string): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 卡片名词干（产物文件去目录去扩展），与导出/贴图同一条规矩。 */
function stemOf(artifactFile: string): string {
  const base = artifactFile.split('/').pop() ?? artifactFile
  return base.replace(/\.skeleton2d\.json$/i, '')
}

/** 一次「载入编辑器」要交出去的文件包：项目文件（可缺）+ 随档文件。 */
interface OpenPayload {
  project?: { name: string; base64: string }
  files: { name: string; base64: string }[]
}

/** v3 外壳 → 直接开它的工作档（随档文件原样带上）。 */
function openPayloadOfShell(shell: Skeleton2dRigbyShell): OpenPayload {
  return {
    project: { name: shell.workfile, base64: textToB64(JSON.stringify(shell.doc)) },
    files: Object.entries(shell.files).map(([name, base64]) => ({ name, base64 })),
  }
}

/**
 * v1 轻模型 → DragonBones 三件套（迁移入口）。
 *
 * `stem` 决定三个文件名：`<stem>_ske.json` / `<stem>_tex.json` / `<stem>.png`——
 * `imagePath` 是 `dragonBonesPackOf` 写死的 `<stem>.png`，贴图字节从工作区路由取。
 */
async function openPayloadOfModel(model: Skeleton2dModel, textureUrl: string, artifactFile: string): Promise<OpenPayload> {
  const stem = stemOf(artifactFile)
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('texture not loadable'))
    image.src = textureUrl
  })
  const pack = dragonBonesPackOf(model, size, stem)
  if (pack === undefined) throw new Error('model cannot be converted')
  const response = await fetch(textureUrl)
  if (!response.ok) throw new Error('texture fetch failed')
  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    project: { name: `${stem}_ske.json`, base64: textToB64(JSON.stringify(pack.skeleton)) },
    files: [
      { name: `${stem}_ske.json`, base64: textToB64(JSON.stringify(pack.skeleton)) },
      { name: `${stem}_tex.json`, base64: textToB64(JSON.stringify(pack.atlas)) },
      { name: `${stem}.png`, base64: bytesToB64(bytes) },
    ],
  }
}

/**
 * Rigby2D 编辑器宿主。`source` 二选一：`{ shell }`（v3 直接开）或 `{ model }`（v1 走
 * DragonBones 迁移）。保存后统一收敛成 v3 外壳落盘。
 */
export function Skeleton2dRigbyEditor(props: {
  projectId: string
  cardId: string
  bridge: HostBridge
  artifactFile: string
  textureUrl: string
  source: { shell?: Skeleton2dRigbyShell; model?: Skeleton2dModel }
  onSaved: () => void
  adopt: (payload: ArtifactView) => void
  t: Translate
}): React.JSX.Element {
  const { projectId, cardId, bridge, artifactFile, textureUrl, source, onSaved, adopt, t } = props
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const openedRef = useRef(false)
  const dirtyRef = useRef(false)

  // 载入 payload 只算一次：source 是调用方从产物解析出来的稳定对象，重算只会重复取贴图。
  const payloadRef = useRef<Promise<OpenPayload | undefined> | undefined>(undefined)
  if (payloadRef.current === undefined) {
    payloadRef.current =
      source.shell !== undefined
        ? Promise.resolve(openPayloadOfShell(source.shell))
        : source.model !== undefined
          ? openPayloadOfModel(source.model, textureUrl, artifactFile).catch((e: unknown) => {
              setError(String(e))
              return undefined
            })
          : Promise.resolve(undefined)
  }

  // 保存的完整收尾：与自研编辑器同一套四步（写 → 缓存作废 → 回读 adopt → 通知画布）。
  const handleSaved = useCallback(
    (files: { name: string; base64: string }[]) => {
      const work = files.find((f) => /\.rigby$/i.test(f.name))
      if (work === undefined) return
      let doc: Record<string, unknown>
      try {
        doc = JSON.parse(base64ToText(work.base64)) as Record<string, unknown>
      } catch {
        setError('saved workfile is not valid JSON')
        return
      }
      const embedded: Record<string, string> = {}
      for (const f of files) {
        if (f === work) continue
        embedded[f.name] = f.base64
      }
      const texture = source.shell?.texture ?? source.model?.texture ?? ''
      const prompt = source.shell?.prompt ?? source.model?.prompt ?? ''
      const snapshot = `${JSON.stringify(
        {
          format: 'dsh-skeleton2d',
          version: 3,
          texture,
          doc,
          workfile: work.name,
          files: embedded,
          prompt,
        },
        null,
        2,
      )}\n`
      setSaving(true)
      void bridge
        .writeText(projectId, cardId, snapshot)
        .then(() => {
          invalidateSkeleton2dModel(projectId, cardId)
          return bridge.readArtifact(projectId, cardId).then((next) => adopt(next))
        })
        .then(() => {
          setSaving(false)
          setDirty(false)
          dirtyRef.current = false
          onSaved()
        })
        .catch(() => setSaving(false))
    },
    [adopt, bridge, cardId, onSaved, projectId, source],
  )

  // 桥消息：ready → 发 open；saved → 落盘；opened 失败 → 报错；dirty → 角标。
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const msg = event.data as { type?: string; ok?: boolean; files?: { name: string; base64: string }[]; dirty?: boolean; error?: string } | null
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'dsh:ready' && !openedRef.current) {
        openedRef.current = true
        setReady(true)
        void payloadRef.current?.then((payload) => {
          if (payload === undefined) return
          iframeRef.current?.contentWindow?.postMessage({ type: 'dsh:open', ...payload }, '*')
        })
        return
      }
      if (msg.type === 'dsh:opened' && msg.ok === false) setError(msg.error ?? 'editor failed to open')
      if (msg.type === 'dsh:saved') handleSaved(msg.files ?? [])
      if (msg.type === 'dsh:dirty') {
        dirtyRef.current = msg.dirty === true
        setDirty(dirtyRef.current)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleSaved])

  return (
    <div className="dsh-canvas-rigby-host">
      {!ready && error === '' ? <div className="dsh-canvas-viewer-note">{t('canvas.viewer.absent')}</div> : null}
      {error !== '' ? <div className="dsh-canvas-viewer-note">{error}</div> : null}
      {ready && dirty ? <div className="dsh-canvas-rigby-dirty">{t('canvas.viewer.edit')}*</div> : null}
      {ready && saving ? <div className="dsh-canvas-rigby-dirty">…</div> : null}
      <iframe ref={iframeRef} src={rigbyEditorUrl()} className="dsh-canvas-rigby-frame" title="Rigby2D" />
    </div>
  )
}
