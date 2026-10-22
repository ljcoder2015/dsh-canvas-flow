/**
 * dsh-canvas — 左侧画布区与主区域的画布席位。
 *
 * 左栏那一段（`sidebar.panellist`，宿主「新会话」与「工作区」之间）只注册**一行**：
 * 画布区自己。行与包裹的呈现归 `canvas-nav.tsx`，本模块管的是它背后的两件事：
 *
 * - 每个画布在 `main` 里有一个面板（key 与画布行同一约定），点画布即切过去；
 * - 画布区那一行的 id 在 `main` 里也有一个面板，就是新建流程——folder picker。
 *
 * 面板靠字符串 key 与行对应，且宿主的 `selectPanel` 找不到同名 `main` 条目时会直接
 * 抛错并保留原选择，所以画布的项目列表每变一次就要补齐/回收对应的面板。
 *
 * 这里也是画布与对话互斥的地方：主区域只有一格，画布占着它就看不到对话，因此画布
 * 里的「对话」动作在把会话设为当前会话之后，还要把主区域交回对话。
 */
import { useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { Project } from '../../../types.ts'
import { NS, type Translate } from '../../ui/locales.ts'
import type { CanvasBridge } from '../../wire/bridge.ts'
import { foreignSeats } from '../../ui/seats.ts'
import { CanvasBoard, type CanvasBoardProps } from '../board/canvas-view.tsx'
import { CanvasNavSeat, CREATE_ID, panelIdOf, type CanvasNavInject, type CanvasNavProps } from './canvas-nav.tsx'
import { ProjectCatalog } from './project-catalog.ts'

/** 画布区那一行在面板列表里的序：画布区靠前，工作区区域在其后。 */
const CREATE_ORDER = 10

/**
 * `ctx.layout` 里画布用到的那一面。
 *
 * 主面板 id 是宿主内部的品牌类型，本包不依赖它的包，因此这里按运行时契约只记下
 * 用到的那一个方法。
 */
interface ForeignLayout {
  selectPanel(panelId: string | null): void
}

/** 新建画布面板的注入面。 */
interface NewCanvasInject {
  bridge: CanvasBridge
  /** 弹系统原生文件夹选择器；用户取消返回 null。 */
  pickDirectory: () => Promise<string | null>
  /** 画布建成后把主区域切过去。 */
  onCreated: (projectId: string) => void
  /** 用户取消选择：主区域交回对话。 */
  onCancel: () => void
}

/** 「新增画布」面板的 props：注入面加上命名空间字典的 `t`（注册时声明了 `locale`）。 */
type NewCanvasPanelProps = InjectFace<NewCanvasInject> & { t: Translate }

/** 「新增画布」的主面板：挂载即弹系统原生文件夹选择器，一次选定即切换。 */
function NewCanvasPanel(props: NewCanvasPanelProps) {
  const { bridge, pickDirectory, onCreated, onCancel, t } = props
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    let cancelled = false
    pickDirectory()
      .then((path) => {
        if (cancelled) return
        if (path === null) {
          onCancel()
          return
        }
        setBusy(true)
        setError('')
        bridge
          .createProject('', path)
          .then((binding) => {
            if (!cancelled) onCreated(binding.project.id)
          })
          .catch((reason: unknown) => {
            if (!cancelled) {
              setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
              setBusy(false)
            }
          })
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : t('canvas.error.unknown'))
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
    }
    // 只在挂载时触发一次：用户点行 → 进面板 → 弹选择器 → 选定/取消 → 面板卸载。
    // 空依赖是刻意的；本仓的 eslint 配置只带 js + typescript-eslint，没有启用
    // react-hooks 规则，所以这里不能写 eslint-disable（会报「规则不存在」），
    // 这一条由评审把关。
  }, [])

  // 选择器在宿主那边，这里只在出错时展示可重试的最小界面。
  if (error) {
    return (
      <div className="dsh-canvas-seat" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--ds-color-danger)' }}>
          <div style={{ marginBottom: 12 }}>{error}</div>
          <button
            className="dsh-canvas-chipbtn"
            onClick={() => {
              setError('')
              setBusy(true)
              pickDirectory().then((path) => {
                if (path === null) onCancel()
                else bridge.createProject('', path).then((binding) => onCreated(binding.project.id)).catch(() => undefined)
              })
            }}
          >
            {t('canvas.action.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="dsh-canvas-seat"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ds-color-text-muted)' }}
    >
      {busy ? t('canvas.manage.picking') : null}
    </div>
  )
}

/** 管理区需要的外部依赖。 */
export interface CanvasPanelsDeps {
  bridge: CanvasBridge
  /** 弹系统原生文件夹选择器；用户取消返回 null。 */
  pickDirectory: () => Promise<string | null>
  /** 让一条会话成为当前会话（宿主的会话域）。 */
  openSession: (sessionId: string) => void
  /** 每次拿到最新项目列表时转交给产物根缓存，让新画布里的文件立刻可被画布标签页认领。 */
  onProjects?: (projects: readonly Project[]) => void
}

/** 管理区交给插件入口的把手。 */
export interface CanvasPanelsHandle {
  /**
   * 读一次画布项目列表。
   *
   * 只能在 Remote 挂载之后调：调用面在挂载前拿不到，读也读不出东西。
   */
  refresh(): void
}

/**
 * 注册画布管理区：侧栏的行与主区域的面板。
 *
 * @param ctx - 客户端根上下文。
 * @param deps - 调用面与会话、产物入口。
 * @returns 让入口在 Remote 挂载后触发首次读取的把手。
 */
export function registerCanvasPanels(ctx: ClientContext, deps: CanvasPanelsDeps): CanvasPanelsHandle {
  const seats = foreignSeats(ctx)
  const layout = (ctx as unknown as { layout: ForeignLayout }).layout
  const t = ctx.locale.bind(NS)
  const catalog = new ProjectCatalog(deps.bridge)
  /** 每个画布一份主面板清理器，按面板 key 记账。 */
  const mounted = new Map<string, () => void>()

  /** 主区域交回对话。画布与对话互斥：主区域只有一格，交出去就等于回到对话。 */
  const handBackMain = (): void => {
    layout.selectPanel(null)
  }

  /** 画布里的「对话」：会话成为当前会话，并把主区域交回对话。 */
  const activateSession = (sessionId: string): void => {
    deps.openSession(sessionId)
    handBackMain()
  }

  /**
   * 把主区域切到某个画布。
   *
   * 画布可能刚刚才被创建——包括画布内部那个「新增画布项目」按钮建的——此时它的
   * `main` 条目还没注册，直接切会抛错，所以先重读列表补齐面板。
   *
   * 这里同时是「用户当前在看哪张画布」唯一的记账点：画布级的 agent 工具
   * （`canvas_read_board` 一族）靠这条全局取值，而主面板的每一次切换——左栏的行、
   * 画布内的选择器、新建后的落位——都从这里过。落盘失败不惊动用户：工具是下一轮
   * 才跑的，最坏也只是让卡片会话回落到它自己所属的画布。
   */
  const openCanvas = (projectId: string): void => {
    void deps.bridge.setActiveProject(projectId).catch(() => undefined)
    void catalog
      .reload()
      .then(() => layout.selectPanel(panelIdOf(projectId)))
      .catch(() => undefined)
  }

  /**
   * 新建画布：主区域交给文件夹选择器。
   *
   * 画布区那一行的 id 在 `main` 里就是这条流程，所以「点画布行」与「点包裹 header
   * 上的加号」是同一条路——收起的 rail 上只剩那一行，两条入口本来就是一回事。
   */
  const createCanvas = (): void => {
    layout.selectPanel(CREATE_ID)
  }

  /** 注册一个画布的主面板，返回回收它的清理器。 */
  const mountCanvas = (project: Project): (() => void) => {
    const id = panelIdOf(project.id)
    return seats.inject('main', () =>
      seats.register(
        {
          name: 'main',
          key: id,
          locale: NS,
          inject: () => ({
            bridge: deps.bridge,
            activateSession,
            projectId: project.id,
            onSelectProject: openCanvas,
          }),
        },
        // 席位由别的包声明，props 到这里已经无类型；组件自己的接口才是它们的说明。
        (props: never) => (
          <div className="dsh-canvas-seat">
            <CanvasBoard {...(props as unknown as CanvasBoardProps)} />
          </div>
        ),
      ),
    )
  }

  /** 项目列表每变一次：为新画布补上面板，为消失的画布回收它们。 */
  const sync = (projects: readonly Project[]): void => {
    deps.onProjects?.(projects)
    const wanted = new Set(projects.map((project) => panelIdOf(project.id)))
    for (const [id, dispose] of [...mounted]) {
      if (wanted.has(id)) continue
      dispose()
      mounted.delete(id)
    }
    for (const project of projects) {
      const id = panelIdOf(project.id)
      if (!mounted.has(id)) mounted.set(id, mountCanvas(project))
    }
  }

  ctx.effect(
    () => {
      // 画布区那一行：图形归它，包裹（header + 画布列表）由它挂到宿主的列表里；
      // 它的同名主面板就是新建流程（folder picker）。行与面板成对注册、成对回收。
      const section = seats.inject('sidebar.panellist', () =>
        seats.register(
          {
            name: 'sidebar.panellist',
            id: CREATE_ID,
            order: CREATE_ORDER,
            label: () => t('canvas.manage.new'),
            locale: NS,
            inject: (): CanvasNavInject => ({ catalog, openCanvas, createCanvas, bridge: deps.bridge, handBackMain }),
          },
          (props: never) => <CanvasNavSeat {...(props as unknown as CanvasNavProps)} />,
        ),
      )
      const createPanel = seats.inject('main', () =>
        seats.register(
          {
            name: 'main',
            key: CREATE_ID,
            locale: NS,
            inject: (): NewCanvasInject => ({
              bridge: deps.bridge,
              pickDirectory: deps.pickDirectory,
              onCreated: openCanvas,
              onCancel: () => layout.selectPanel(null),
            }),
          },
          (props: never) => <NewCanvasPanel {...(props as unknown as NewCanvasPanelProps)} />,
        ),
      )

      const unsubscribe = catalog.subscribe(sync)

      return () => {
        unsubscribe()
        section()
        createPanel()
        for (const dispose of mounted.values()) dispose()
        mounted.clear()
      }
    },
    'dsh-canvas: canvas seats',
  )

  return {
    refresh: () => {
      void catalog.refresh()
    },
  }
}
