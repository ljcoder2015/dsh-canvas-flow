/**
 * dsh-canvas — markdown 图片引用 → 浏览器加载得到的地址（v1.92 图文并茂）。
 *
 * 渲染器（`markdown.ts`）把「src 换写成什么」交给了调用方；这个文件就是**有上下文的
 * 调用方**的那半个答案：全屏预览知道 projectId 与产物路径，于是可以把三类引用各送到
 * 它该去的地方——
 *
 * - `http(s)://` 与 `data:image/`：本来就能加载，原样放行；
 * - **相对路径**（`cover.png`、`../images/fig-1.png`）与**项目根相对**（`/images/x.png`）：
 *   换写成宿主的工作区路由（`contract.ts` 的 `WORKSPACE_ROUTE`），由宿主按项目根送字节；
 * - 其余一切带协议的 src（`javascript:`、`data:text/html`、私有 scheme）：拒绝，渲染器
 *   会把它降级成原文字面量——**宁可少一张图，不能多一条脚本信道**。
 *
 * 纯函数、零 React 依赖，node 单测即可覆盖（`tests/client/artifact/markdown-image.spec.ts`）。
 */
import { WORKSPACE_ROUTE } from '../../../contract.ts'
import { hostBase } from '../../canvas/project/open-folder.ts'

/**
 * Resolve one image reference from a markdown artifact into a loadable URL.
 *
 * @param projectId - the canvas project the artifact belongs to.
 * @param artifactFile - the artifact's own path, relative to the project root;
 *   relative references resolve against its directory.
 * @param src - the reference exactly as written in the markdown.
 * @returns the URL an `<img>` may load, or `undefined` when this reference must
 *   not render (unknown scheme, escape above the project root, empty).
 */
export function markdownImageSrc(
  projectId: string,
  artifactFile: string,
  src: string,
): string | undefined {
  const trimmed = src.trim()
  if (trimmed === '') return undefined
  // 远端与内联图本来就能加载；`loading` 策略是渲染器的事，这里只管地址。
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^data:image\//i.test(trimmed)) return trimmed
  // 其余带协议的（`javascript:`、`data:text/html`、桌面端的私有 scheme）都不是插图，
  // 是脚本信道——渲染器的构造闸还会再拦一道，但这里的答案就是「不渲染」。
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined

  // 相对引用以产物所在目录为基准；以 `/` 开头的是项目根相对（markdown 里没有第二种
  // 「站点」，这里的站点就是画布项目本身）。`..` 逐段上收，收出根就是越界。
  const directory = directoryOf(artifactFile)
  const parts = trimmed.startsWith('/') ? [] : directory === '' ? [] : directory.split('/')
  for (const segment of trimmed.replace(/^\/+/, '').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  if (parts.length === 0) return undefined
  const path = `${WORKSPACE_ROUTE}/${encodeURIComponent(projectId)}/${parts.map(encodeURIComponent).join('/')}`
  return new URL(path, hostBase()).href
}

/** 产物路径的最后一段目录；产物在项目根上时是空串。 */
function directoryOf(file: string): string {
  const at = file.lastIndexOf('/')
  return at === -1 ? '' : file.slice(0, at)
}
