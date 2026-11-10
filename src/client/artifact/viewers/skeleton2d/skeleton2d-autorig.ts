/**
 * dsh-canvas — skeleton2d 的「一键自动分层建骨」（客户端，碰 DOM）。
 *
 * 算法全在 `core/skeleton2d/layerize.ts`（纯、可判据）；这里只做三件浏览器才能做的事：
 * 把贴图加载进来、画进一张离屏画布取像素、把结果装回模型。分开的理由与舞台那边一样：
 * 纯的那部分要能在 node 里跑判据，碰 canvas 的这一层不该有第二份算术。
 *
 * 为什么放在客户端：分层要读像素，而宿主侧没有图像解码依赖（也不该为一件事拖进来一个）。
 * 浏览器本来就把贴图解码好了——同一张图既在卡面上播，也在这里被切，两边看到的是同一份
 * 像素，不会出现「显示的和切出来的不一样」。
 */

import { layerize, withRig } from '../../../../core/skeleton2d/layerize.ts'
import type { Skeleton2dModel } from '../../../../core/skeleton2d/model.ts'

/** 加载一张图；失败（贴图被删、路由拒绝）返回 `undefined`——调用方说一句人话就是。 */
function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(undefined)
    image.src = url
  })
}

/**
 * 读贴图 → 自动分层 → 返回**新的模型**（不改入参）。
 *
 * 返回 `undefined` 的两种情形都等于「这张图分不出层来」：图加载不了、或剪影太小/全透明。
 * 它们不是异常：调用方保持原样（没分层时整幅当一层，画面照旧会动）。
 */
export async function autoRigModel(model: Skeleton2dModel, textureUrl: string): Promise<Skeleton2dModel | undefined> {
  const image = await loadImage(textureUrl)
  if (image === undefined || image.naturalWidth === 0 || image.naturalHeight === 0) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return undefined
  context.drawImage(image, 0, 0)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  const result = layerize({ width: canvas.width, height: canvas.height, data: pixels.data })
  if (result === undefined) return undefined
  return withRig(model, result)
}
