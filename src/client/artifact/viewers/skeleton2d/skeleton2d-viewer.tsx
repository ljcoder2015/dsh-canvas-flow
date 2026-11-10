/**
 * dsh-canvas — skeleton2d 卡的全屏预览器（预览 / 编辑双态）。
 *
 * 预览那一面与媒体三态同一个位置、同一条规矩：产物自己就是画面，所以画的是**动起来
 * 的贴图**，不是那串 JSON。编辑那一面（`skeleton2d-editor.tsx`）是同一块画布加一栏参数
 * 面板，改动防抖写回产物本体。模型与贴图的读取规则在 `use-skeleton2d.tsx`（卡面与全屏
 * 共用）。
 *
 * 「预览 / 编辑」的切换钮挂在头部插槽（`Slot at="header"`）——外壳只给位置、内容归
 * 预览器（chrome.tsx 开头那段说明）。编辑态 Esc 先退编辑态再谈关窗（`useEscapeLayer`
 * 的顺位语义）。
 *
 * 「没有东西 / 读不懂」翻成人话——文案与媒体卡用同一批键，免得同一件事在两个地方
 * 说成两句不同的话。
 */

import { useState } from 'react'
import { Slot, useChrome, useEscapeLayer } from '../../chrome.tsx'
import type { Translate } from '../../../ui/locales.ts'
import type { ArtifactView } from '../../../../types.ts'
import { Skeleton2dAnimation, skeleton2dTextureUrl, useSkeleton2dModel } from './use-skeleton2d.tsx'
import { Skeleton2dEditor } from './skeleton2d-editor.tsx'
import type { ViewerRegistration } from '../types.ts'

/** The skeleton2d viewer: the animated model, letterboxed on a plain surface. */
export function Skeleton2dViewer({ view, t }: { view: ArtifactView; t: Translate }) {
  const chrome = useChrome()
  const load = useSkeleton2dModel(chrome.bridge, chrome.projectId, view.cardId, view.bytes, view.present && view.text !== '')
  const [editing, setEditing] = useState(false)
  // 编辑态占一层 Esc：先退编辑态，再轮到关窗。挂在组件顶上，顺位在最前。
  useEscapeLayer(editing, () => setEditing(false))

  if (load === undefined || load.status === 'absent') {
    return <div className="dsh-canvas-viewer-note">{t('canvas.viewer.absent')}</div>
  }
  // `empty` 与 `bad` 是两句不同的话吗？在这里它们都不是——一个空文件与一份写坏的 JSON
  // 修法相同（重新生成一次），媒体卡把 `empty` 退给大纲行，这里没有大纲行可退，取
  // 「读不出来」那句共用文案。
  if (load.status === 'empty' || load.status === 'bad') {
    return <div className="dsh-canvas-viewer-note">{t('canvas.viewer.tooLarge')}</div>
  }
  const textureUrl = skeleton2dTextureUrl(chrome.projectId, view.file, load.model.texture)
  if (textureUrl === undefined) {
    return <div className="dsh-canvas-viewer-note">{t('canvas.viewer.tooLarge')}</div>
  }
  return (
    <>
      <Slot at="header">
        <button
          type="button"
          className="dsh-canvas-chipbtn"
          onClick={() => setEditing((current) => !current)}
          title={editing ? t('canvas.viewer.preview') : t('canvas.viewer.edit')}
        >
          {editing ? t('canvas.viewer.preview') : t('canvas.viewer.edit')}
        </button>
      </Slot>
      <div className="dsh-canvas-media">
        {editing ? (
          <Skeleton2dEditor
            projectId={chrome.projectId}
            cardId={chrome.cardId}
            bridge={chrome.bridge}
            disk={load.model}
            textureUrl={textureUrl}
            onSaved={chrome.saved}
            adopt={chrome.adopt}
            t={t}
          />
        ) : (
          <Skeleton2dAnimation model={load.model} textureUrl={textureUrl} className="dsh-canvas-skeleton2d-view" />
        )}
      </div>
    </>
  )
}

/** 注册项：认领 `skeleton2d` 一个 kind。payload 是 JSON + 贴图，编辑面是参数面板不是文本。 */
export const skeleton2dViewer: ViewerRegistration = {
  id: 'skeleton2d',
  component: Skeleton2dViewer,
  claims: (kind) => kind === 'skeleton2d',
}
