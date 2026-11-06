/**
 * dsh-canvas — 媒体卡底栏那颗「参数」面板：**这张卡怎么做图 / 做片**。
 *
 * 与 ModelPicker 是兄弟控件（同一条底栏、同一套菜单长相、同一个落点——卡片记录），
 * 但它记的不是「用哪个模型」，而是「生成时带哪些参数」：
 *
 * - **图片卡**：五组档位 chip（画质 / 清晰度 / 背景 / 比例 / 生成数量）。点击选中、
 *   再点取消；什么都没选就是全部交给模型默认。去向分三层，档位清单与换算规则都在
 *   `core/media/editing.ts`：清晰度 × 比例换算协议的 `size`，画质与背景写成 prompt
 *   末尾的导演指令，数量由宿主循环兑现（第一张落卡片，其余落兄弟路径、扫描后成卡）。
 * - **视频卡**：首帧 / 尾帧参考图、相机（固定机位走协议字段，运镜档位写成提示词里的
 *   导演指令——两种去向都由 `core/media/editing.ts` 与 `core/media/ark.ts` 说了算）。
 * - **音频卡**没有参数，这颗按钮不出现。
 *
 * 写入走 `setMediaParams`：面板每次交**一整包归一后的参数**（空对象 = 清除全部），而不是
 * 逐字段打补丁——「同一个东西两个来源」的教训（v1.8x 反复踩）在这里的落法是：草稿态只在
 * 面板里活着，真相永远是卡片记录，`params` 属性一变草稿就跟上。
 */
import { useEffect, useState } from 'react'
import {
  CAMERA_MODES,
  IMAGE_BACKGROUNDS,
  IMAGE_COUNTS,
  IMAGE_QUALITIES,
  IMAGE_RATIOS,
  IMAGE_RESOLUTIONS,
  normalizeMediaParams,
  type CameraMode,
  type ImageBackground,
  type ImageQuality,
  type MediaParams,
} from '../../../core/media/editing.ts'
import { mediaCapabilityOf } from '../model/model-seat.ts'
import type { Translate } from '../locales.ts'

/** 面板需要的全部外部能力——与 `ModelBridge` 同一条结构型纪律，不要求整个桥。 */
export interface MediaParamsBridge {
  /** 写这张卡的生成参数；空对象清除全部。 */
  setMediaParams(projectId: string, cardId: string, params: MediaParams): Promise<unknown>
}

/** 相机每一档的文案键（含「自动」这一档 = 字段不设）。 */
const CAMERA_LABEL: Record<CameraMode | 'auto', 'canvas.params.cameraAuto' | 'canvas.params.cameraFixed' | 'canvas.params.cameraPushIn' | 'canvas.params.cameraPullOut' | 'canvas.params.cameraPanLeft' | 'canvas.params.cameraPanRight' | 'canvas.params.cameraTiltUp' | 'canvas.params.cameraTiltDown'> = {
  auto: 'canvas.params.cameraAuto',
  fixed: 'canvas.params.cameraFixed',
  push_in: 'canvas.params.cameraPushIn',
  pull_out: 'canvas.params.cameraPullOut',
  pan_left: 'canvas.params.cameraPanLeft',
  pan_right: 'canvas.params.cameraPanRight',
  tilt_up: 'canvas.params.cameraTiltUp',
  tilt_down: 'canvas.params.cameraTiltDown',
}

/** 画质每一档的文案键。 */
const QUALITY_LABEL: Record<ImageQuality, 'canvas.params.qualityLow' | 'canvas.params.qualityStandard' | 'canvas.params.qualityHigh' | 'canvas.params.qualityUltra' | 'canvas.params.qualityExtreme'> = {
  low: 'canvas.params.qualityLow',
  standard: 'canvas.params.qualityStandard',
  high: 'canvas.params.qualityHigh',
  ultra: 'canvas.params.qualityUltra',
  extreme: 'canvas.params.qualityExtreme',
}

/** 背景每一档的文案键。 */
const BACKGROUND_LABEL: Record<ImageBackground, 'canvas.params.bgAuto' | 'canvas.params.bgKeep' | 'canvas.params.bgTransparent'> = {
  auto: 'canvas.params.bgAuto',
  keep: 'canvas.params.bgKeep',
  transparent: 'canvas.params.bgTransparent',
}

/** 一颗 chip 上的小画幅示意：按比例算出的描边小矩形（最长边 14px，短边按比例）。 */
function ratioShape(ratio: string): { width: number; height: number } {
  const [a, b] = ratio.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { width: 10, height: 10 }
  const scale = 14 / Math.max(a, b)
  return { width: Math.max(4, Math.round(a * scale)), height: Math.max(4, Math.round(b * scale)) }
}

/**
 * 一组档位 chip：标题一行、chip 换行平铺。点击选中、再点已选中的那颗取消——
 * 「没选」是每组的合法状态，意思是这一组交给模型默认；所以这里没有到处都挂一个
 * 「自动」档，取消本身就是自动。
 */
function ChipGroup({
  label, options, current, onPick,
}: {
  label: string
  options: readonly { value: string; label: string; shape?: { width: number; height: number } }[]
  current: string | undefined
  onPick: (next: string | undefined) => void
}) {
  return (
    <div className="dsh-canvas-chipgroup">
      <div className="dsh-canvas-modelgroup">{label}</div>
      <div className="dsh-canvas-chips">
        {options.map((option) => {
          const active = current === option.value
          return (
            <button
              className="dsh-canvas-chip"
              role="menuitemradio"
              aria-checked={active}
              data-current={active ? 'true' : 'false'}
              key={option.value}
              onClick={() => onPick(active ? undefined : option.value)}
            >
              {option.shape !== undefined ? (
                <span
                  aria-hidden="true"
                  className="dsh-canvas-chipshape"
                  style={{ width: option.shape.width, height: option.shape.height }}
                />
              ) : null}
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 一行文本框：blur 或 Enter 提交、Esc 复原——与设计面板那两只输入框（NumField / TextField）
 * 同一条提交纪律，只是这里的值是路径这类**随卡片保存**的字符串。
 */
function ParamField({
  label, value, placeholder, onCommit,
}: {
  label: string
  value: string
  placeholder: string
  onCommit: (next: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => {
    setText(value)
  }, [value])
  const revert = (): void => setText(value)
  return (
    <label className="dsh-canvas-paramsrow">
      <span className="dsh-canvas-paramslabel">{label}</span>
      <input
        className="dsh-canvas-paramsinput"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== value) onCommit(text)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (text !== value) onCommit(text)
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            revert()
          }
        }}
      />
    </label>
  )
}

export function MediaParamsPicker({
  bridge, projectId, cardId, kind, params, t,
}: {
  bridge: MediaParamsBridge
  projectId: string
  cardId: string
  /** 节点类型（与 ModelPicker 同一个来源）：面板按它决定出图片参数还是视频参数。 */
  kind: string
  /** 卡片记录里设下的参数；`undefined` 即「没设过」。 */
  params: MediaParams | undefined
  t: Translate
}) {
  const capability = mediaCapabilityOf(kind)
  const isImage = capability === 'image'
  const isVideo = capability === 'video'
  const [open, setOpen] = useState(false)
  // 草稿态：面板开着的时候它是真的；一关上，下一轮 props 同步把它按回记录。
  const [draft, setDraft] = useState<MediaParams>(params ?? {})
  useEffect(() => {
    setDraft(params ?? {})
  }, [params])
  const [error, setError] = useState('')

  // 音频卡没有可设的参数：不是「禁用」，是这颗按钮压根不出现。判据放在 hooks 之后——
  // 组件的挂载次数不能随档位漂移，否则 React 会把两个不同卡的 hooks 串起来。
  if (!isImage && !isVideo) return null

  /** 交一包归一后的参数（空对象 = 清除全部）；本地先跟上，真相仍是卡片记录。 */
  const commit = (next: MediaParams): void => {
    setDraft(next)
    setError('')
    bridge
      .setMediaParams(projectId, cardId, next)
      .catch((writeError: unknown) => setError(writeError instanceof Error ? writeError.message : String(writeError)))
  }
  /** 把一包草稿送去归一——空串与没设在这里变成同一种状态。 */
  const send = (next: MediaParams): void => commit(normalizeMediaParams(next) ?? {})

  const camera = draft.camera

  return (
    <span className="dsh-canvas-modelzone">
      <button
        className="dsh-canvas-modelbtn"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-params="true"
        title={isImage ? t('canvas.params.imageTitle') : t('canvas.params.videoTitle')}
      >
        {t('canvas.composer.params')}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="dsh-canvas-menu is-raised dsh-canvas-modelmenu dsh-canvas-paramsmenu" role="menu">
          <span className="dsh-canvas-composer-menunote">{t('canvas.composer.paramsNote')}</span>
          {error !== '' ? <span className="dsh-canvas-composer-menunote">{t('canvas.params.failed', { message: error })}</span> : null}
          {isImage ? (
            <>
              <ChipGroup
                label={t('canvas.params.groupQuality')}
                current={draft.quality}
                options={IMAGE_QUALITIES.map((value) => ({ value, label: t(QUALITY_LABEL[value]) }))}
                onPick={(next) => send({ ...draft, quality: next as ImageQuality | undefined })}
              />
              <ChipGroup
                label={t('canvas.params.groupResolution')}
                current={draft.resolution}
                options={IMAGE_RESOLUTIONS.map((value) => ({ value, label: value }))}
                onPick={(next) => send({ ...draft, resolution: next as MediaParams['resolution'] })}
              />
              <ChipGroup
                label={t('canvas.params.groupBackground')}
                current={draft.background}
                options={IMAGE_BACKGROUNDS.map((value) => ({ value, label: t(BACKGROUND_LABEL[value]) }))}
                onPick={(next) => send({ ...draft, background: next as ImageBackground | undefined })}
              />
              <ChipGroup
                label={t('canvas.params.groupRatio')}
                current={draft.ratio}
                options={IMAGE_RATIOS.map((value) => ({ value, label: value, shape: ratioShape(value) }))}
                onPick={(next) => send({ ...draft, ratio: next as MediaParams['ratio'] })}
              />
              <ChipGroup
                label={t('canvas.params.groupCount')}
                current={draft.count === undefined ? undefined : String(draft.count)}
                options={IMAGE_COUNTS.map((value) => ({ value: String(value), label: t('canvas.params.countSheets', { count: value }) }))}
                onPick={(next) => send({ ...draft, count: next === undefined ? undefined : (Number.parseInt(next, 10) as MediaParams['count']) })}
              />
            </>
          ) : (
            <>
              <ParamField
                label={t('canvas.params.firstFrame')}
                value={draft.firstFramePath ?? ''}
                placeholder={t('canvas.params.pathHint')}
                onCommit={(next) => send({ ...draft, firstFramePath: next })}
              />
              <ParamField
                label={t('canvas.params.lastFrame')}
                value={draft.lastFramePath ?? ''}
                placeholder={t('canvas.params.pathHint')}
                onCommit={(next) => send({ ...draft, lastFramePath: next })}
              />
              <div className="dsh-canvas-modelgroup">{t('canvas.params.camera')}</div>
              {(['auto', ...CAMERA_MODES] as const).map((candidate) => (
                <button
                  className="dsh-canvas-row"
                  role="menuitemradio"
                  aria-checked={camera === (candidate === 'auto' ? undefined : candidate)}
                  data-current={camera === (candidate === 'auto' ? undefined : candidate) ? 'true' : 'false'}
                  key={candidate}
                  onClick={() => send({ ...draft, camera: candidate === 'auto' ? undefined : candidate })}
                >
                  {t(CAMERA_LABEL[candidate])}
                </button>
              ))}
              {camera !== undefined && camera !== 'fixed' ? (
                <span className="dsh-canvas-composer-menunote">{t('canvas.params.cameraNote')}</span>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </span>
  )
}
