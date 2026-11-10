/**
 * dsh-canvas — live2d 卡的编辑器（全屏预览器的「编辑」那一面）。
 *
 * 四种模式（对照 Cubism Editor 的四块工作区）：
 *
 * - **参数**：循环时长、三组动作的幅度 / 拍数 / 相位、锚点——「活着的默认样子」；
 * - **网格**：贴图上铺开网格顶点，拖哪个哪个就带着贴图走——雕刻进 `deform.offsets`
 *   的静态形状（Cubism 的顶点编辑）；
 * - **骨骼**：贴图上落关节（父级＝当前选中）、拖动调位置，选中一根骨骼后时间线出它
 *   的旋转轨道——关键帧驱动整条骨骼链（Cubism 的变形器 / 骨骼那一半）；
 * - **时间线**：三组动作各一条轨道，键加在轨道上就是关键帧驱动，余弦插值、环绕无缝
 *   （Cubism 的动画工作区）。有键的动作拍数 / 相位退位，幅度照旧缩放整条曲线。
 *
 * 保存走防抖自动写：改动停手 600ms 落盘一次，写回的就是产物本体（`serializeLive2dModel`
 * 的稳定序列化 → 桥上的 `writeText`）。卸载即冲刷——防抖窗口不是丢数据窗口。
 *
 * 时间线的播放头与画面共用同一只钟（`Live2dAnimation` 的 `clockRef`，每帧写、不触发
 * 渲染）；网格与时间线的坐标换算、拾取、绘制是纯函数，判据在各自的 spec 里。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactView } from '../../../../types.ts'
import {
  DEFORM_MAX,
  serializeLive2dModel,
  type Live2dBone,
  type Live2dKeyframe,
  type Live2dModel,
  type Live2dMotion,
} from '../../../../core/live2d/model.ts'
import { motionValueAt } from '../../../../core/live2d/rig.ts'
import { BONE_ROT_MAX, boneRotationAt } from '../../../../core/live2d/bones.ts'
import type { Translate } from '../../../ui/locales.ts'
import { Live2dAnimation, invalidateLive2dModel } from './use-live2d.tsx'
import { anchorFromPoint, containLayout } from './live2d-editor-layout.ts'
import { drawMeshOverlay, dragOffset, isZeroOffset, nearestVertex } from './live2d-mesh.ts'
import { boneUVFromPoint, drawBonesOverlay, nearestBone, nextBoneName } from './live2d-bones.ts'
import {
  drawTimeline,
  nearestKey,
  RULER_HEIGHT,
  trackAt,
  trackRects,
  xToTime,
  yToValue,
} from './live2d-timeline.ts'

/** 编辑器只需要的那两条缝：写回产物本体、再读一次（与 `ArtifactModalBridge` 相容）。 */
export interface Live2dWriter {
  writeText(projectId: string, cardId: string, content: string): Promise<unknown>
  readArtifact(projectId: string, cardId: string): Promise<ArtifactView>
}

/** 停止拖动到落盘的间隔：比手快慢半拍，比扫盘快得多。 */
const SAVE_DEBOUNCE_MS = 600

/** 一组动作的取值范围（与 `core/live2d/model.ts` 的归一一致——面板只是同一副夹子的手柄）。 */
const CYCLES_MAX = 8
const AMPLITUDE_MAX = 0.2
const LOOP_MIN = 1
const LOOP_MAX = 12

/** 时间线条的高度（像素）。 */
const TIMELINE_HEIGHT = 150

/** 位移落盘的量化位数：与 `model.ts` 的归一同一副（万分之一）。 */
function quantize(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** 保存状态：面板底行的一句话。 */
type SaveStatus = 'idle' | 'saving' | 'saved'

/** 编辑器的四种模式。 */
export type Live2dEditorMode = 'params' | 'mesh' | 'bones' | 'timeline'

const MOTION_KEYS = ['breath', 'sway', 'tilt'] as const
type MotionKey = (typeof MOTION_KEYS)[number]

/**
 * 一组动作的三根手柄：幅度（滑条）、拍数（步进）、相位（滑条）。幅度 0 就是这组动作
 * 关掉——面板不另设开关，0 本身就是关。有关键帧时拍数 / 相位退位（只点亮，不改值）。
 */
function MotionGroup(props: {
  label: string
  motion: Live2dMotion
  onChange: (next: Live2dMotion) => void
  t: Translate
}) {
  const { label, motion, onChange, t } = props
  const keyed = motion.keys !== undefined && motion.keys.length >= 2
  return (
    <div className="dsh-canvas-live2d-group">
      <div className="dsh-canvas-live2d-title">
        {label}
        {keyed ? <span className="dsh-canvas-live2d-badge">{t('canvas.live2d.keyed')}</span> : null}
      </div>
      <label className="dsh-canvas-live2d-row">
        <span className="dsh-canvas-live2d-key">{t('canvas.live2d.amplitude')}</span>
        <input
          type="range"
          className="dsh-canvas-live2d-slider"
          min={0}
          max={AMPLITUDE_MAX}
          step={0.001}
          value={motion.amplitude}
          onChange={(event) => onChange({ ...motion, amplitude: Number(event.target.value) })}
        />
        <span className="dsh-canvas-live2d-value">{(motion.amplitude * 100).toFixed(1)}%</span>
      </label>
      <label className="dsh-canvas-live2d-row">
        <span className="dsh-canvas-live2d-key">{t('canvas.live2d.cycles')}</span>
        <span className="dsh-canvas-live2d-step">
          <button
            type="button"
            className="dsh-canvas-chipbtn"
            disabled={keyed || motion.cycles <= 0}
            onClick={() => onChange({ ...motion, cycles: Math.max(0, motion.cycles - 1) })}
            aria-label="cycles down"
          >
            −
          </button>
          <span className="dsh-canvas-live2d-value">{motion.cycles}</span>
          <button
            type="button"
            className="dsh-canvas-chipbtn"
            disabled={keyed || motion.cycles >= CYCLES_MAX}
            onClick={() => onChange({ ...motion, cycles: Math.min(CYCLES_MAX, motion.cycles + 1) })}
            aria-label="cycles up"
          >
            +
          </button>
        </span>
      </label>
      <label className="dsh-canvas-live2d-row">
        <span className="dsh-canvas-live2d-key">{t('canvas.live2d.phase')}</span>
        <input
          type="range"
          className="dsh-canvas-live2d-slider"
          min={0}
          max={0.999}
          step={0.01}
          disabled={keyed}
          value={motion.phase}
          onChange={(event) => onChange({ ...motion, phase: Number(event.target.value) })}
        />
        <span className="dsh-canvas-live2d-value">{Math.round(motion.phase * 100)}%</span>
      </label>
    </div>
  )
}

/** live2d 编辑器：动画 + 三种模式的面板 + 防抖自动保存。 */
export function Live2dEditor(props: {
  projectId: string
  cardId: string
  bridge: Live2dWriter
  /** 盘上的模型（编辑器挂载时的起点；外部的改动会收进来，见下）。 */
  disk: Live2dModel
  textureUrl: string
  /** 一次写入落地了——交给外壳，画布据此重读（卡面的动画跟着换参数）。 */
  onSaved: () => void
  /** 把回读到的产物交给弹窗：预览态的 view.bytes 换成新的一版。 */
  adopt: (payload: ArtifactView) => void
  t: Translate
}) {
  const { projectId, cardId, bridge, disk, textureUrl, onSaved, adopt, t } = props

  // 草稿即真源：面板改的是它，动画放的是它，落盘的也是它。
  const [draft, setDraft] = useState<Live2dModel>(disk)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [status, setStatus] = useState<SaveStatus>('idle')
  /** 我们认为盘上现在是什么（上次成功写出的序列化，或读到的起点）。 */
  const savedRef = useRef(serializeLive2dModel(disk))

  // 模式：参数是出厂档，网格与时间线各占一层交互。
  const [mode, setMode] = useState<Live2dEditorMode>('params')

  // 贴图真实比例：锚点、网格、点击换算都靠它；没量到之前按 1:1。
  const [aspect, setAspect] = useState(1)

  // 盘上变了：自己写出去的回声（内容与 savedRef 一致）收下不动作；**别人的**改动
  // （会话里重新生成过、JSON 被直接编辑过）收进草稿——编辑器不说「我覆写你的」。
  useEffect(() => {
    const payload = serializeLive2dModel(disk)
    if (payload === savedRef.current) return
    savedRef.current = payload
    setDraft(disk)
    setStatus('idle')
  }, [disk])

  // 一次落盘的完整收尾：写 → 缓存作废 → 回读 adopt → 通知画布。缓存作废不能省——
  // 缓存键是 bytes，**字节长度相同的两次改动是不同的内容**，不作废旧模型会被永远重放；
  // 回读 adopt 也不能省——弹窗里的 view 是打开时读的那一版，不换它，切回预览态用的
  // 还是旧键、画出来的还是旧参数。
  const save = useCallback(
    (snapshot: string) => {
      setStatus('saving')
      void bridge
        .writeText(projectId, cardId, snapshot)
        .then(() => {
          savedRef.current = snapshot
          setStatus('saved')
          invalidateLive2dModel(projectId, cardId)
          void bridge
            .readArtifact(projectId, cardId)
            .then((next) => adopt(next))
            .catch(() => undefined)
          onSaved()
        })
        .catch(() => setStatus('idle'))
    },
    [adopt, bridge, cardId, onSaved, projectId],
  )

  // 防抖自动保存：草稿与「认为盘上的」不一致就排一次写，停手 600ms 落盘。网格拖拽与
  // 时间线拖键每一帧都在改草稿——防抖天然把连续拖动合并成「停手后一次写」。
  useEffect(() => {
    const payload = serializeLive2dModel(draft)
    if (payload === savedRef.current) return undefined
    const timer = window.setTimeout(() => {
      save(serializeLive2dModel(draftRef.current))
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, save])

  // 卸载即冲刷：拖完一根滑条立刻切回预览（或关掉弹窗），防抖的定时器随卸载被清掉
  // ——那一趟改动不能跟着丢。写「此刻的草稿」，不写排定时器时的那份。
  useEffect(
    () => () => {
      const snapshot = serializeLive2dModel(draftRef.current)
      if (snapshot !== savedRef.current) save(snapshot)
    },
    [save],
  )

  // 贴合盒的实时尺寸：锚点标记、网格叠层、时间线都按它换算。两条观察一条就够。
  const stageRef = useRef<HTMLDivElement | null>(null)
  const timelineStripRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [strip, setStrip] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = stageRef.current
    if (node === null) return
    const measure = (): void => setBox({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (mode !== 'timeline' && mode !== 'bones') return
    const node = timelineStripRef.current
    if (node === null) return
    const measure = (): void => setStrip({ width: node.clientWidth, height: node.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [mode])

  const setMotion = useCallback((key: MotionKey, next: Live2dMotion) => {
    setDraft((current) => ({ ...current, [key]: next }))
  }, [])

  const setLoop = useCallback((next: number) => {
    setDraft((current) => ({ ...current, loop: Math.min(60, Math.max(1, next)) }))
  }, [])

  const resetAnchor = useCallback(() => {
    setDraft((current) => ({ ...current, anchor: { x: 0.5, y: 1 } }))
  }, [])

  /** 清一组动作的关键帧：回到正弦驱动（拍数 / 相位重新生效）。 */
  const clearKeys = useCallback((key: MotionKey) => {
    setDraft((current) => {
      const motion = current[key] as Live2dMotion
      const next: Live2dMotion = { cycles: motion.cycles, amplitude: motion.amplitude, phase: motion.phase }
      return { ...current, [key]: next }
    })
  }, [])

  /** 清掉全部雕刻：网格回到方方正正。 */
  const resetDeform = useCallback(() => {
    setDraft((current) => {
      const next: Live2dModel = { ...current }
      delete next.deform
      return next
    })
  }, [])

  const stageBox = containLayout(aspect, box.width, box.height)

  // ── 参数模式：点击画面放锚点 ──────────────────────────────────────────────
  const onStageClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== 'params') return
      const rect = event.currentTarget.getBoundingClientRect()
      const anchor = anchorFromPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        aspect,
      )
      setDraft((current) => ({ ...current, anchor }))
    },
    [aspect, mode],
  )

  // ── 网格模式：叠层画布 + 顶点拖拽 ─────────────────────────────────────────
  const meshCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{ col: number; row: number } | undefined>(undefined)
  const dragging = useRef<{ col: number; row: number } | undefined>(undefined)

  const redrawMesh = useCallback(() => {
    const canvas = meshCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null || ctx === undefined) return
    drawMeshOverlay(ctx, stageBox, draftRef.current, dragging.current ?? hover)
  }, [hover, stageBox])

  // 尺寸 / 草稿 / 悬停变了就重画。叠层 canvas 的位图尺寸跟着盒子走（DPR 先不管——
  // 叠层是细线与圆点，非整数缩放的可读性损失可忽略，换来的是少一套换算）。
  useEffect(() => {
    const canvas = meshCanvasRef.current
    if (mode !== 'mesh' || canvas === null) return
    if (canvas.width !== box.width || canvas.height !== box.height) {
      canvas.width = box.width
      canvas.height = box.height
    }
    redrawMesh()
  }, [box.width, box.height, draft, hover, mode, redrawMesh])

  const onMeshPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const hit = nearestVertex(event.clientX - rect.left, event.clientY - rect.top, stageBox)
      if (hit === undefined) return
      dragging.current = hit
      event.currentTarget.setPointerCapture(event.pointerId)
      setHover(hit)
    },
    [stageBox],
  )

  const onMeshPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const grabbed = dragging.current
      if (grabbed === undefined) {
        const hit = nearestVertex(px, py, stageBox)
        if (hit?.col !== hover?.col || hit?.row !== hover?.row) setHover(hit)
        return
      }
      const [du, dv] = dragOffset(px, py, grabbed.col, grabbed.row, stageBox, DEFORM_MAX)
      const offset: [number, number] = [quantize(du), quantize(dv)]
      setDraft((current) => {
        const offsets = { ...(current.deform?.offsets ?? {}) }
        const key = `${grabbed.col},${grabbed.row}`
        if (isZeroOffset(offset)) delete offsets[key]
        else offsets[key] = offset
        const deform = Object.keys(offsets).length === 0 ? undefined : { offsets }
        const next: Live2dModel = { ...current }
        if (deform === undefined) delete next.deform
        else next.deform = deform
        return next
      })
    },
    [hover?.col, hover?.row, stageBox],
  )

  const onMeshPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  // ── 骨骼模式：关节的增 / 拖 / 删 + 选中骨骼的旋转轨道 ────────────────────
  const bonesCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [boneSel, setBoneSel] = useState<number | undefined>(undefined)
  const [boneHover, setBoneHover] = useState<number | undefined>(undefined)
  const boneDrag = useRef<number | undefined>(undefined)

  const bones = draft.bones ?? []
  const bonesRef = useRef(bones)
  bonesRef.current = bones
  // boneSel 的 ref：addBone 与轨道事件在回调执行时要用「此刻的选中」，不能等下一次渲染。
  const boneSelRef = useRef<number | undefined>(undefined)
  boneSelRef.current = boneSel

  /** 改一根骨骼（按序号）；坐标由调用方夹好。 */
  const setBone = useCallback((index: number, next: Live2dBone) => {
    setDraft((current) => {
      const list = [...(current.bones ?? [])]
      list[index] = next
      return { ...current, bones: list }
    })
  }, [])

  /** 加一根骨骼：落点为 uv，父级＝当前选中的那根（先父后子的次序由「只能选早的」维持）。 */
  const addBone = useCallback((u: number, v: number) => {
    setDraft((current) => {
      const list = current.bones ?? []
      const parent = boneSelRef.current !== undefined ? list[boneSelRef.current]?.name : undefined
      const bone: Live2dBone = {
        name: nextBoneName(list),
        x: u,
        y: v,
        ...(parent !== undefined ? { parent } : {}),
      }
      return { ...current, bones: [...list, bone] }
    })
    // 新骨排在队尾，选中它——「接着从这根往下挂」是绑骨的默认节奏。
    setBoneSel(bonesRef.current.length)
  }, [])

  /** 删一根骨骼：子级自动上提给被删者的父级，它的轨道一起收掉。 */
  const removeBone = useCallback((index: number) => {
    setDraft((current) => {
      const list = current.bones ?? []
      const gone = list[index]
      if (gone === undefined) return current
      const parent = gone.parent
      const nextBones = list
        .filter((_, i) => i !== index)
        .map((bone) => (bone.parent === gone.name ? { ...bone, ...(parent === undefined ? {} : { parent }) } : bone))
      const tracks = { ...(current.boneTracks ?? {}) }
      delete tracks[gone.name]
      return {
        ...current,
        bones: nextBones,
        ...(Object.keys(tracks).length === 0 ? {} : { boneTracks: tracks }),
      }
    })
    setBoneSel(undefined)
  }, [])

  /** 清掉全部骨骼与轨道。 */
  const clearBones = useCallback(() => {
    setDraft((current) => {
      const next: Live2dModel = { ...current }
      delete next.bones
      delete next.boneTracks
      return next
    })
    setBoneSel(undefined)
  }, [])

  const redrawBones = useCallback(() => {
    const canvas = bonesCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null || ctx === undefined) return
    drawBonesOverlay(ctx, stageBox, bonesRef.current, boneDrag.current ?? boneSel)
  }, [boneSel, stageBox])

  useEffect(() => {
    const canvas = bonesCanvasRef.current
    if (mode !== 'bones' || canvas === null) return
    if (canvas.width !== box.width || canvas.height !== box.height) {
      canvas.width = box.width
      canvas.height = box.height
    }
    redrawBones()
  }, [box.width, box.height, draft, mode, redrawBones])

  const onBonesPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const hit = nearestBone(px, py, bonesRef.current, stageBox)
      if (hit !== undefined) {
        boneDrag.current = hit
        setBoneSel(hit)
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      // 空白处一击 = 落一枚新关节（父级＝当前选中）。落点夹在贴合盒的 uv 里。
      const { x, y } = boneUVFromPoint(px, py, stageBox)
      addBone(x, y)
    },
    [addBone, stageBox],
  )

  const onBonesPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const grabbed = boneDrag.current
      if (grabbed === undefined) {
        const hit = nearestBone(px, py, bonesRef.current, stageBox)
        if (hit !== boneHover) setBoneHover(hit)
        return
      }
      const { x, y } = boneUVFromPoint(px, py, stageBox)
      setBone(grabbed, { ...(bonesRef.current[grabbed] as Live2dBone), x, y })
    },
    [boneHover, setBone, stageBox],
  )

  const onBonesPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    boneDrag.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  // ── 骨骼旋转轨道：一条轨道（选中的骨骼），键在 [-1,1] 上映射 ±BONE_ROT_MAX ──
  const bonesStripCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const boneRects = useMemo(() => trackRects(1, strip.height), [strip.height])
  const boneGrabbed = useRef<number | undefined>(undefined)
  const [boneGrabbedKey, setBoneGrabbedKey] = useState<number | undefined>(undefined)

  /** 改某根骨骼的旋转键表；凑不足两键就整体收回静止。 */
  const setBoneKeys = useCallback((name: string, keys: Live2dKeyframe[] | undefined) => {
    setDraft((current) => {
      const tracks = { ...(current.boneTracks ?? {}) }
      if (keys === undefined || keys.length < 2) delete tracks[name]
      else tracks[name] = { rot: keys.map((k) => ({ t: k.t, v: k.v })) }
      return {
        ...current,
        ...(Object.keys(tracks).length === 0 ? {} : { boneTracks: tracks }),
      }
    })
  }, [])

  // 骨骼轨道的绘制循环（与时间线同一套 rAF 纪律：常转、数据每帧现读）。
  useEffect(() => {
    if (mode !== 'bones' || boneSel === undefined) return
    const canvas = bonesStripCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null || ctx === undefined) return
    if (canvas.width !== strip.width || canvas.height !== strip.height) {
      canvas.width = strip.width
      canvas.height = strip.height
    }
    let raf = 0
    const draw = (): void => {
      const model = draftRef.current
      const loop = model.loop
      const bone = (model.bones ?? [])[boneSel]
      const rot = bone === undefined ? undefined : model.boneTracks?.[bone.name]?.rot
      const playhead = (((clockRef.current % loop) + loop) % loop) / loop
      const value = bone === undefined ? 0 : boneRotationAt(rot, clockRef.current, loop) / BONE_ROT_MAX
      const sampled =
        bone === undefined
          ? undefined
          : (p: number): number => boneRotationAt(rot, p * loop, loop) / BONE_ROT_MAX
      drawTimeline(
        ctx,
        strip.width,
        strip.height,
        boneRects,
        [value],
        [rot],
        sampled === undefined ? [] : [sampled],
        playhead,
        boneGrabbed.current === undefined ? undefined : { track: 0, key: boneGrabbed.current },
      )
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [boneGrabbedKey, boneRects, boneSel, mode, strip.height, strip.width])

  const onBoneTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const selected = boneSelRef.current
      if (selected === undefined) return
      const bone = bonesRef.current[selected]
      if (bone === undefined) return
      // 标尺带：拖播放头 = 定格到某一刻（与动作时间线同一条手感）。
      if (py <= RULER_HEIGHT + 4) {
        scrubbing.current = true
        setPlaying(false)
        timeHold.current = xToTime(px, strip.width) * draftRef.current.loop
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      const rect1 = boneRects[0]
      if (rect1 === undefined) return
      const keys = draftRef.current.boneTracks?.[bone.name]?.rot
      if (keys !== undefined && keys.length >= 2) {
        const hit = nearestKey(px, py, keys, rect1, strip.width)
        if (hit !== undefined) {
          boneGrabbed.current = hit
          setBoneGrabbedKey(hit)
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
      }
      // 空处一击 = 开启这根骨的旋转曲线：点中的位置落第一枚键（值取点击的 v——用户
      // 点的是「想在的角度」），半循环后落第二枚（值取当前采样，曲线从现状起步）。
      const t = Math.min(0.999, xToTime(px, strip.width))
      const v = yToValue(py, rect1)
      const loop = draftRef.current.loop
      const half = (t + 0.5) % 1
      const seeded: Live2dKeyframe[] = [
        { t: quantize(t), v: quantize(v) },
        { t: quantize(half), v: quantize(boneRotationAt(keys, half * loop, loop) / BONE_ROT_MAX) },
      ].sort((a, b) => a.t - b.t)
      setBoneKeys(bone.name, seeded)
    },
    [boneRects, setBoneKeys, strip.width],
  )

  const onBoneTrackPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (scrubbing.current) {
        timeHold.current = xToTime(event.clientX - rect.left, strip.width) * draftRef.current.loop
        return
      }
      const holding = boneGrabbed.current
      if (holding === undefined) return
      const selected = boneSelRef.current
      if (selected === undefined) return
      const bone = bonesRef.current[selected]
      if (bone === undefined) return
      const keys = [...(draftRef.current.boneTracks?.[bone.name]?.rot ?? [])]
      if (keys[holding] === undefined) return
      const rect1 = boneRects[0]
      if (rect1 === undefined) return
      // 时刻夹在左右邻居之间（同动作轨道）：键不许穿过彼此。
      const lower = holding === 0 ? 0 : (keys[holding - 1] as Live2dKeyframe).t + 0.001
      const upper = holding === keys.length - 1 ? 0.999 : (keys[holding + 1] as Live2dKeyframe).t - 0.001
      const t = Math.min(upper, Math.max(lower, xToTime(event.clientX - rect.left, strip.width)))
      keys[holding] = { t: quantize(t), v: quantize(yToValue(event.clientY - rect.top, rect1)) }
      setBoneKeys(bone.name, keys)
    },
    [boneRects, setBoneKeys, strip.width],
  )

  const onBoneTrackPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    scrubbing.current = false
    boneGrabbed.current = undefined
    setBoneGrabbedKey(undefined)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onBoneTrackDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const selected = boneSelRef.current
      if (selected === undefined) return
      const bone = bonesRef.current[selected]
      if (bone === undefined) return
      const rect = event.currentTarget.getBoundingClientRect()
      const keys = draftRef.current.boneTracks?.[bone.name]?.rot
      const rect1 = boneRects[0]
      if (keys === undefined || keys.length < 2 || rect1 === undefined) return
      const hit = nearestKey(event.clientX - rect.left, event.clientY - rect.top, keys, rect1, strip.width)
      if (hit === undefined) return
      setBoneKeys(bone.name, keys.filter((_, index) => index !== hit))
    },
    [boneRects, setBoneKeys, strip.width],
  )

  // ── 时间线模式：画布 + 键的加 / 拖 / 删 ──────────────────────────────────
  const timelineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const clockRef = useRef(0)
  /** 定格时间：非 undefined 时画面停在这一刻（网格编辑、暂停、拖播放头都用它）。 */
  const timeHold = useRef<number | undefined>(undefined)
  const [playing, setPlaying] = useState(true)
  const scrubbing = useRef(false)
  const grabbed = useRef<{ track: number; key: number } | undefined>(undefined)
  const [grabbedKey, setGrabbedKey] = useState<{ track: number; key: number } | undefined>(undefined)

  // 定格的规矩：网格模式一律冻结在当前帧（雕刻要看清形状）；时间线与骨骼模式按播放 /
  // 暂停；参数模式永远在放（那是最像成品的预览）。
  useEffect(() => {
    if (mode === 'mesh') {
      timeHold.current = clockRef.current
      return
    }
    if ((mode === 'timeline' || mode === 'bones') && !playing) {
      if (timeHold.current === undefined) timeHold.current = clockRef.current
      return
    }
    timeHold.current = undefined
  }, [mode, playing])

  const rects = useMemo(() => trackRects(MOTION_KEYS.length, strip.height), [strip.height])

  /** 改某条轨道的键表；凑不足两键就整体收回正弦。 */
  const setKeys = useCallback((track: MotionKey, keys: Live2dKeyframe[] | undefined) => {
    setDraft((current) => {
      const motion = current[track] as Live2dMotion
      const nextMotion: Live2dMotion =
        keys === undefined || keys.length < 2
          ? { cycles: motion.cycles, amplitude: motion.amplitude, phase: motion.phase }
          : { ...motion, keys: keys.map((k) => ({ t: k.t, v: k.v })) }
      return { ...current, [track]: nextMotion }
    })
  }, [])

  // 时间线的绘制循环：rAF 常转（播放头与曲线都在动），数据每帧从 draftRef 现读。
  useEffect(() => {
    if (mode !== 'timeline') return
    const canvas = timelineCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || ctx === null || ctx === undefined) return
    if (canvas.width !== strip.width || canvas.height !== strip.height) {
      canvas.width = strip.width
      canvas.height = strip.height
    }
    let raf = 0
    const draw = (): void => {
      const model = draftRef.current
      const loop = model.loop
      const playhead = (((clockRef.current % loop) + loop) % loop) / loop
      const values = MOTION_KEYS.map((key) => motionValueAt(model[key] as Live2dMotion, clockRef.current, loop))
      const keys = MOTION_KEYS.map((key) => (model[key] as Live2dMotion).keys)
      const sampled = MOTION_KEYS.map((key) => {
        const motion = model[key] as Live2dMotion
        return (p: number): number => motionValueAt(motion, p * loop, loop)
      })
      drawTimeline(ctx, strip.width, strip.height, rects, values, keys, sampled, playhead, grabbed.current ?? grabbedKey)
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [grabbedKey, mode, rects, strip.height, strip.width])

  const onTimelinePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      // 标尺带：拖播放头 = 定格到某一刻（与 Cubism 的时间轴同一条手感）。拖动即暂停，
      // 松手后停在那一帧，按播放才继续。
      if (py <= RULER_HEIGHT + 4) {
        scrubbing.current = true
        setPlaying(false)
        timeHold.current = xToTime(px, strip.width) * draftRef.current.loop
        event.currentTarget.setPointerCapture(event.pointerId)
        return
      }
      const track = trackAt(py, rects)
      if (track === undefined) return
      const motionKey = MOTION_KEYS[track] as MotionKey
      const keys = (draftRef.current[motionKey] as Live2dMotion).keys
      if (keys !== undefined && keys.length >= 2) {
        const hit = nearestKey(px, py, keys, rects[track] as (typeof rects)[number], strip.width)
        if (hit !== undefined) {
          grabbed.current = { track, key: hit }
          setGrabbedKey({ track, key: hit })
          event.currentTarget.setPointerCapture(event.pointerId)
          return
        }
      }
      // 空处一击 = 开启关键帧驱动：点中的位置落第一枚键，半循环后落第二枚（值取正弦
      // 在那里的现状）——曲线从「你现在点的样子」起步，用户再顺手修。键按 t 排好序
      // 再存：`sampleKeys` 假定升序，乱序的键表会让曲线在缝合处打结。
      const t = Math.min(0.999, xToTime(px, strip.width))
      const v = yToValue(py, rects[track] as (typeof rects)[number])
      const motion = draftRef.current[motionKey] as Live2dMotion
      const loop = draftRef.current.loop
      const half = (t + 0.5) % 1
      const seeded: Live2dKeyframe[] = [
        { t: quantize(t), v: quantize(v) },
        { t: quantize(Math.min(0.999, half)), v: quantize(motionValueAt(motion, half * loop, loop)) },
      ].sort((a, b) => a.t - b.t)
      setKeys(motionKey, seeded)
    },
    [rects, setKeys, strip.width],
  )

  const onTimelinePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (scrubbing.current) {
        timeHold.current = xToTime(event.clientX - rect.left, strip.width) * draftRef.current.loop
        return
      }
      const holding = grabbed.current
      if (holding === undefined) return
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const motionKey = MOTION_KEYS[holding.track] as MotionKey
      const keys = [...((draftRef.current[motionKey] as Live2dMotion).keys ?? [])]
      if (keys[holding.key] === undefined) return
      // 时刻夹在左右邻居之间（首尾各自贴边）：键不许穿过彼此——换序会让「按住的是
      // 哪一枚」失去意义，也省掉拖动中的重排序。
      const lower = holding.key === 0 ? 0 : (keys[holding.key - 1] as Live2dKeyframe).t + 0.001
      const upper = holding.key === keys.length - 1 ? 0.999 : (keys[holding.key + 1] as Live2dKeyframe).t - 0.001
      const t = Math.min(upper, Math.max(lower, xToTime(px, strip.width)))
      keys[holding.key] = { t: quantize(t), v: quantize(yToValue(py, rects[holding.track] as (typeof rects)[number])) }
      setKeys(motionKey, keys)
    },
    [rects, setKeys, strip.width],
  )

  const onTimelinePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    scrubbing.current = false
    grabbed.current = undefined
    setGrabbedKey(undefined)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const onTimelineDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const track = trackAt(py, rects)
      if (track === undefined) return
      const motionKey = MOTION_KEYS[track] as MotionKey
      const keys = (draftRef.current[motionKey] as Live2dMotion).keys
      if (keys === undefined || keys.length < 2) return
      const hit = nearestKey(px, py, keys, rects[track] as (typeof rects)[number], strip.width)
      if (hit === undefined) return
      const rest = keys.filter((_, index) => index !== hit)
      setKeys(motionKey, rest)
    },
    [rects, setKeys, strip.width],
  )

  const modeLabels: Record<Live2dEditorMode, string> = {
    params: t('canvas.live2d.modeParams'),
    mesh: t('canvas.live2d.modeMesh'),
    bones: t('canvas.live2d.modeBones'),
    timeline: t('canvas.live2d.modeTimeline'),
  }
  const motionLabels: Record<MotionKey, string> = {
    breath: t('canvas.live2d.breath'),
    sway: t('canvas.live2d.sway'),
    tilt: t('canvas.live2d.tilt'),
  }

  return (
    <div className="dsh-canvas-live2d-editor">
      <div className="dsh-canvas-live2d-main">
        <div ref={stageRef} className="dsh-canvas-live2d-stagebox" onClick={onStageClick}>
          <Live2dAnimation
            model={draft}
            textureUrl={textureUrl}
            className="dsh-canvas-live2d-view"
            onAspect={setAspect}
            clockRef={clockRef}
            timeRef={timeHold}
          />
          {/* 锚点标记：参数模式才可点可放；网格 / 时间线模式它只作参照。 */}
          {box.width > 0 ? (
            <span
              className="dsh-canvas-live2d-anchor"
              style={{ left: stageBox.left + draft.anchor.x * stageBox.width, top: stageBox.top + draft.anchor.y * stageBox.height }}
            />
          ) : null}
          {mode === 'mesh' ? (
            <canvas
              ref={meshCanvasRef}
              className="dsh-canvas-live2d-meshoverlay"
              onPointerDown={onMeshPointerDown}
              onPointerMove={onMeshPointerMove}
              onPointerUp={onMeshPointerUp}
            />
          ) : null}
          {mode === 'bones' ? (
            <canvas
              ref={bonesCanvasRef}
              className="dsh-canvas-live2d-meshoverlay"
              onPointerDown={onBonesPointerDown}
              onPointerMove={onBonesPointerMove}
              onPointerUp={onBonesPointerUp}
            />
          ) : null}
        </div>
        <div className="dsh-canvas-live2d-panel">
          <div className="dsh-canvas-live2d-tabs">
            {(['params', 'mesh', 'bones', 'timeline'] as const).map((next) => (
              <button
                key={next}
                type="button"
                className="dsh-canvas-live2d-tab"
                data-current={mode === next}
                onClick={() => setMode(next)}
              >
                {modeLabels[next]}
              </button>
            ))}
          </div>
          {mode === 'params' ? (
            <>
              <div className="dsh-canvas-live2d-group">
                <div className="dsh-canvas-live2d-title">{t('canvas.live2d.loop')}</div>
                <label className="dsh-canvas-live2d-row">
                  <input
                    type="range"
                    className="dsh-canvas-live2d-slider"
                    min={LOOP_MIN}
                    max={LOOP_MAX}
                    step={0.1}
                    value={draft.loop}
                    onChange={(event) => setLoop(Number(event.target.value))}
                  />
                  <span className="dsh-canvas-live2d-value">{draft.loop.toFixed(1)}s</span>
                </label>
              </div>
              <MotionGroup label={t('canvas.live2d.breath')} motion={draft.breath} onChange={(next) => setMotion('breath', next)} t={t} />
              <MotionGroup label={t('canvas.live2d.sway')} motion={draft.sway} onChange={(next) => setMotion('sway', next)} t={t} />
              <MotionGroup label={t('canvas.live2d.tilt')} motion={draft.tilt} onChange={(next) => setMotion('tilt', next)} t={t} />
              <div className="dsh-canvas-live2d-group">
                <div className="dsh-canvas-live2d-title">
                  {t('canvas.live2d.anchor')}
                  <button type="button" className="dsh-canvas-chipbtn" onClick={resetAnchor}>
                    {t('canvas.live2d.resetAnchor')}
                  </button>
                </div>
                <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.anchorHint')}</div>
                <div className="dsh-canvas-live2d-coords">
                  ({draft.anchor.x.toFixed(2)}, {draft.anchor.y.toFixed(2)})
                </div>
              </div>
            </>
          ) : null}
          {mode === 'mesh' ? (
            <div className="dsh-canvas-live2d-group">
              <div className="dsh-canvas-live2d-title">
                {t('canvas.live2d.meshTitle')}
                <button type="button" className="dsh-canvas-chipbtn" onClick={resetDeform} disabled={draft.deform === undefined}>
                  {t('canvas.live2d.meshReset')}
                </button>
              </div>
              <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.meshHint')}</div>
              <div className="dsh-canvas-live2d-coords">
                {t('canvas.live2d.meshCount', { count: String(Object.keys(draft.deform?.offsets ?? {}).length) })}
              </div>
            </div>
          ) : null}
          {mode === 'bones' ? (
            <>
              <div className="dsh-canvas-live2d-group">
                <div className="dsh-canvas-live2d-title">
                  {t('canvas.live2d.bonesTitle')}
                  <button
                    type="button"
                    className="dsh-canvas-chipbtn"
                    onClick={clearBones}
                    disabled={bones.length === 0}
                  >
                    {t('canvas.live2d.bonesClear')}
                  </button>
                </div>
                <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.bonesHint')}</div>
                <div className="dsh-canvas-live2d-coords">
                  {t('canvas.live2d.bonesCount', { count: String(bones.length) })}
                </div>
              </div>
              {boneSel !== undefined ? (
                <div className="dsh-canvas-live2d-group">
                  <div className="dsh-canvas-live2d-title">
                    {t('canvas.live2d.playhead')}
                    <button type="button" className="dsh-canvas-chipbtn" onClick={() => setPlaying((current) => !current)}>
                      {playing ? t('canvas.live2d.pause') : t('canvas.live2d.play')}
                    </button>
                  </div>
                  <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.boneTrackHint')}</div>
                </div>
              ) : null}
              {boneSel !== undefined && (bones[boneSel] as Live2dBone | undefined) !== undefined ? (
                <div className="dsh-canvas-live2d-group">
                  <div className="dsh-canvas-live2d-title">
                    {(bones[boneSel] as Live2dBone).name}
                    <button
                      type="button"
                      className="dsh-canvas-chipbtn"
                      onClick={() => removeBone(boneSel)}
                    >
                      {t('canvas.live2d.boneDelete')}
                    </button>
                  </div>
                  <label className="dsh-canvas-live2d-row">
                    <span className="dsh-canvas-live2d-key">{t('canvas.live2d.boneParent')}</span>
                    <select
                      className="dsh-canvas-live2d-parent"
                      value={(bones[boneSel] as Live2dBone).parent ?? ''}
                      onChange={(event) => {
                        const parent = event.target.value
                        const bone = bones[boneSel] as Live2dBone
                        setBone(boneSel, { ...bone, ...(parent === '' ? {} : { parent }) })
                      }}
                    >
                      <option value="">{t('canvas.live2d.boneNoParent')}</option>
                      {/* 父级只能选数组里更早的骨骼：先父后子的次序是层级合成的地基。 */}
                      {bones.slice(0, boneSel).map((bone) => (
                        <option key={bone.name} value={bone.name}>
                          {bone.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {boneSel + 1 < bones.length ? (
                    <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.boneChildHint')}</div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          {mode === 'timeline' ? (
            <>
              <div className="dsh-canvas-live2d-group">
                <div className="dsh-canvas-live2d-title">
                  {t('canvas.live2d.playhead')}
                  <button type="button" className="dsh-canvas-chipbtn" onClick={() => setPlaying((current) => !current)}>
                    {playing ? t('canvas.live2d.pause') : t('canvas.live2d.play')}
                  </button>
                </div>
                <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.scrubHint')}</div>
              </div>
              {MOTION_KEYS.map((key) => {
                const motion = draft[key] as Live2dMotion
                const keyed = motion.keys !== undefined && motion.keys.length >= 2
                return (
                  <div key={key} className="dsh-canvas-live2d-group">
                    <div className="dsh-canvas-live2d-title">
                      {motionLabels[key]}
                      <button type="button" className="dsh-canvas-chipbtn" onClick={() => clearKeys(key)} disabled={!keyed}>
                        {t('canvas.live2d.keysClear')}
                      </button>
                    </div>
                    <div className="dsh-canvas-live2d-coords">
                      {keyed
                        ? t('canvas.live2d.keysCount', { count: String(motion.keys?.length ?? 0) })
                        : t('canvas.live2d.keysSine')}
                    </div>
                  </div>
                )
              })}
              <div className="dsh-canvas-live2d-hint">{t('canvas.live2d.timelineHint')}</div>
            </>
          ) : null}
          <div className="dsh-canvas-live2d-status">
            {status === 'saving' ? t('canvas.viewer.save') : status === 'saved' ? t('canvas.viewer.saved') : ''}
          </div>
        </div>
      </div>
      {mode === 'timeline' ? (
        <div ref={timelineStripRef} className="dsh-canvas-live2d-strip">
          <canvas
            ref={timelineCanvasRef}
            className="dsh-canvas-live2d-timeline"
            style={{ height: TIMELINE_HEIGHT }}
            onPointerDown={onTimelinePointerDown}
            onPointerMove={onTimelinePointerMove}
            onPointerUp={onTimelinePointerUp}
            onDoubleClick={onTimelineDoubleClick}
          />
        </div>
      ) : null}
      {mode === 'bones' && boneSel !== undefined ? (
        <div ref={timelineStripRef} className="dsh-canvas-live2d-strip">
          <canvas
            ref={bonesStripCanvasRef}
            className="dsh-canvas-live2d-timeline"
            style={{ height: TIMELINE_HEIGHT }}
            onPointerDown={onBoneTrackPointerDown}
            onPointerMove={onBoneTrackPointerMove}
            onPointerUp={onBoneTrackPointerUp}
            onDoubleClick={onBoneTrackDoubleClick}
          />
        </div>
      ) : null}
    </div>
  )
}

