/**
 * dsh-canvas — markdown 预览器。
 *
 * 渲染是纯函数的（`markdown.ts`），编辑面是共用的（`editing/editable-text.tsx`）。
 * 这里剩的是「预览长什么样」、**图片引用的换写**（v1.92 图文并茂）与**发布入口**
 * （v1.93 → v1.95）：只有这里同时知道 projectId 与产物路径，相对引用才换写得出
 * 工作区路由的 URL；也只有「markdown 这一种产物」有发布的资格——发布适配吃的是
 * 全文文本。
 *
 * 发布**不在这里渲染**（v1.95）：它是一个铺满画布的独立页面，归属在画布
 * （`canvas-view.tsx`）。按钮只把「去发布」这件事交给外壳（`openPublish`），
 * 弹窗随即关掉——编辑器需要的地方，浮层给不了。
 */
import { useCallback, useMemo } from 'react'
import { Slot, useChrome } from '../chrome.tsx'
import { EditableText } from '../editing/editable-text.tsx'
import { renderMarkdown } from './markdown.ts'
import { markdownImageSrc } from './markdown-image.ts'
import type { ViewerProps, ViewerRegistration } from './types.ts'

/**
 * 预览面：吃的是草稿（比盘上新的时候），不是 payload。
 *
 * 组件本体经 `useCallback` 钉住身份：`EditableText` 的 preview 槽按组件类型挂载，
 * 身份随每次渲染换新就等于每次重挂预览。依赖只有 projectId 与产物路径——两者都变
 * 的时候（改名、换项目）重挂一次是应该的。
 */
function MarkdownViewer({ view }: ViewerProps) {
  const { projectId, openPublish, t } = useChrome()
  const file = view.file
  const Preview = useCallback(
    ({ text }: { text: string }) => {
      const html = useMemo(
        () =>
          renderMarkdown(text, {
            imageSrc: (src) => markdownImageSrc(projectId, file, src),
          }),
        [text, projectId, file],
      )
      return <div className="dsh-canvas-md" dangerouslySetInnerHTML={{ __html: html }} />
    },
    [projectId, file],
  )
  return (
    <>
      <Slot at="header">
        <button type="button" className="dsh-canvas-chipbtn" onClick={openPublish} title={t('canvas.card.publish')}>
          {t('canvas.publish')}
        </button>
      </Slot>
      <EditableText view={view} preview={Preview} />
    </>
  )
}

/**
 * 注册项：markdown 独占一个预览器。
 *
 * 「它能就地编辑」不再是这里的一条声明：编辑是这一面自己按 payload 判出来的
 * （`editing/writable.ts` 拿 kind 与 present / truncated 两半一起看），所以注册项只剩下
 * 认领哪些 kind 这一件事。
 */
export const markdownViewer: ViewerRegistration = {
  id: 'markdown',
  component: MarkdownViewer,
  claims: (kind) => kind === 'markdown',
}
