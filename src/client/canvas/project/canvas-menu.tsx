/**
 * dsh-canvas — 画布行的两个动作（F1.5 修订）。
 *
 * 画布列表里的一条画布需要两个「关于这张画布本身」的动作，而它们都不属于画布
 * 面板内部：**打开画布目录**（把这台机器上的文件夹交给系统文件管理器）与**删除
 * 画布**（把这张画布从列表里移开，磁盘一个字节都不动）。
 *
 * 它们住在**行右侧的操作按钮**里（v1.33 起；此前住在右键菜单里）：指针落到那一
 * 行才露面的一枚省略号，点开是一张锚着它的下拉菜单——与左栏「工作区」那一段的
 * 行操作**同款同源**：同样的浮层原语、同样的令牌与圆角、同样的「点外面 / Esc /
 * 移开指针即关」的规矩。左右两段列表因此读起来是一套东西。
 *
 * 这一层只做两件事：把动作**画出来**、把动作**接到调用点上**。两旁的判断都在别处，
 * 各自待在一个不碰宿主 UI 原语的模块里，于是单测能直接跑它们：
 *
 * - 「该有哪几行、每行叫什么、哪一行是破坏性的」→ `row-actions.ts`；
 * - 「怎么把目录交给系统文件管理器、这台机器上有没有」→ `open-folder.ts`。
 *
 * 留下的两件事在这里定：
 *
 * - **删除只删画布**。`canvas/removeProject` 的语义是「忘掉这张画布」——卡片座次、
 *   引用关系、笔记一起消失，磁盘上的文件夹与文件原样保留。文案必须把这一点说在
 *   前头：这是用户点下删除时最怕的那件事。
 * - **浮层两件都交给宿主的原语**（`Menu` / `Modal`），插件不再自己往 body 上挂
 *   东西。宿主那两枚原语自带 portal、遮罩、Esc、焦点与无障碍角色，也自带主题
 *   令牌——画布那套 `--dsh-*` 变量只活在 `.dsh-canvas-root` 里，跨 portal 带过去
 *   正是旧版要写一层零尺寸容器、再补一个 `.dsh-canvas-floating` 变量的全部原因。
 *   让它们留在宿主的配色里还另有一层意思：这两件说的是**左栏那一段列表**的事，
 *   与画布内部的深色工作台无关。
 */
import { useCallback, useState, type ReactNode } from 'react'
import {
  Button,
  IconEllipsisOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconTrashOutlineRegular,
  Menu,
  Modal,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Project } from '../../../types.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import type { Translate } from '../../ui/locales.ts'
import { ROW_ACTIONS, rowActions, type RowActionId } from './row-actions.ts'

/**
 * 行操作菜单里的那几行。
 *
 * 「该有哪几行」由 `row-actions.ts` 定（纯策略）；这里只把每个动作配上图形——`Menu`
 * 的每一行都带一枚前导图形，宿主那一段工作区列表也是这么画的。
 *
 * @param app - 宿主这台机器上的文件管理器标识；空串表示打不开目录。
 * @param t - 字典。
 * @returns 按显示顺序排好的菜单行。
 */
export function rowMenuItems(app: string, t: Translate): MenuEntry[] {
  const icons: Record<RowActionId, ReactNode> = {
    open: <IconFolderOpenOutlineRegular />,
    remove: <IconTrashOutlineRegular />,
  }
  return rowActions(app).map((id) => ({
    id,
    label: t(ROW_ACTIONS[id].label),
    icon: icons[id],
    // `false` 与「不声明」在宿主那边是两回事：只声明真的破坏性的那一行。
    ...(ROW_ACTIONS[id].danger ? { danger: true } : {}),
  }))
}

/** 画布行的操作按钮与它下拉出来的菜单。 */
export interface CanvasRowMenuProps {
  /** 这一行是哪张画布；只用来把无障碍名说清楚。 */
  project: Project
  /** 菜单是否开着（由列表持有，同一时刻只允许一行开着）。 */
  open: boolean
  /** 开合请求：调用点据此记账。 */
  onOpenChange: (open: boolean) => void
  /** 宿主这台机器上的文件管理器标识；空串表示打不开目录，那一项不出现。 */
  app: string
  t: Translate
  /** 打开画布目录。 */
  onOpenFolder: () => void
  /** 删除画布（先问一句，问在确认框里）。 */
  onRemove: () => void
}

/**
 * 画布行的操作按钮。
 *
 * 按钮本身是宿主 `Menu` 的锚点，所以菜单的位置、贴边回拉、滚动跟随都由宿主自己
 * 算——插件不再需要一个 `placeMenu` 纯函数，也不会出现「菜单长到视口外面」的
 * 那一类缺陷。
 *
 * 按下去不让事件继续走：这一行的行体是「切到这张画布」，点省略号不该顺带切过去。
 * 菜单项也走同一条路——菜单被 portal 到 body，但 React 的事件沿 **React 树**上溯，
 * 所以它照样会经过这里；不拦的话，选「打开目录」会连带把画布切一次。
 */
export function CanvasRowMenu(props: CanvasRowMenuProps) {
  const { project, open, onOpenChange, app, t, onOpenFolder, onRemove } = props

  /** 选一行：菜单先关（接着要开的可能是确认框，别让菜单压在它上面），再动作。 */
  const pick = (id: string): void => {
    onOpenChange(false)
    if (id === 'open') onOpenFolder()
    else if (id === 'remove') onRemove()
  }

  const label = t('canvas.menu.aria', { name: project.name })

  return (
    <span className="dsh-canvas-navactions" data-open={open ? 'true' : undefined}>
      <Menu
        open={open}
        anchor={(
          <button
            type="button"
            className="dsh-canvas-navicon"
            aria-label={label}
            title={label}
            onClick={(event) => {
              event.stopPropagation()
              onOpenChange(!open)
            }}
          >
            <IconEllipsisOutlineRegular />
          </button>
        )}
        items={rowMenuItems(app, t)}
        onSelect={pick}
        onClose={() => {
          onOpenChange(false)
        }}
        portal
        closeOnPointerLeave
      />
    </span>
  )
}

/** 删除画布的确认框。 */
export interface CanvasDeleteProps {
  project: Project
  bridge: CanvasBridge
  t: Translate
  /** 删掉了：调用点负责把主区域从这张画布上挪开并刷新列表。 */
  onRemoved: () => void
  onClose: () => void
}

/**
 * 删除确认。
 *
 * 没有「撤销」可点，所以确认之前把后果说明白：磁盘上的东西都在，消失的是这张画布
 * 自己的排版与引用关系。用宿主的 `Modal`（左栏「工作区」删除那一张是同款），于是
 * Esc、点遮罩即关、`role="dialog"` 都由宿主给全，插件只管这一句话写得对不对。
 *
 * 两枚按钮都是描边款、焦点落在「取消」上：破坏性的那一个要用户真的把指针移过去。
 */
export function CanvasDeleteDialog(props: CanvasDeleteProps) {
  const { project, bridge, t, onRemoved, onClose } = props
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = useCallback((): void => {
    if (busy) return
    setBusy(true)
    setError('')
    bridge
      .removeProject(project.id)
      .then(() => {
        // 删成功之后就不要再碰本组件自己的状态了：调用点会把这张框卸掉。
        onRemoved()
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
        setBusy(false)
      })
  }, [bridge, busy, onRemoved, project.id, t])

  const footer: ReactNode = (
    <>
      <Button variant="outline" disabled={busy} onClick={onClose}>
        {t('canvas.action.cancel')}
      </Button>
      <Button variant="outline" disabled={busy} onClick={confirm}>
        {t('canvas.action.delete')}
      </Button>
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('canvas.action.cancel')}
      title={t('canvas.menu.remove.title')}
      description={t('canvas.menu.remove.desc', { name: project.name })}
      footer={footer}
    >
      {/* 路径单独一行而不是塞进说明句：它可能很长，混进句子里那句话会被读成一条路径。
          这也是「你说的到底是哪个目录」的唯一交代。 */}
      <div className="dsh-canvas-navmodal-path">{project.root}</div>
      {busy ? (
        <div className="dsh-canvas-navmodal-status" role="status">
          {t('canvas.menu.remove.pending')}
        </div>
      ) : null}
      {error === '' ? null : (
        <div className="dsh-canvas-navmodal-error" role="alert">
          {t('canvas.error', { message: error })}
        </div>
      )}
    </Modal>
  )
}
