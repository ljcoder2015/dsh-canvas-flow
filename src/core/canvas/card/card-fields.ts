/**
 * dsh-canvas — 卡片记录上那些「只存差异」的字段，摊成可以直接展开的形状（F2.7）。
 *
 * 这个模块只有一个函数，存在的理由值得写清楚：卡片记录里有一类字段是**派生默认 + 只存
 * 差异**——不写就等于「没选过 / 没设过」，读的人不必区分 `undefined` 与空串。而
 * `BoardCard` 是四处各自拼出来的（板面读、移动、改名、选生成模型），把这条
 * `undefined → 不出现` 的规则抄四遍，就有四份会各自漂移的实现；漂移的表现是**某个入口
 * 之后这个字段忽然消失**（比如拖一下卡片，选好的生成模型就不见了），而它不报错。
 *
 * 所以规则只写一次，四个地方都写 `...mediaSlotOf(record)`。
 */
import type { MediaParams } from '../../media/editing.ts'

/**
 * 卡片选定的生成模型，摊成可展开的片段。
 *
 * @param record - 卡片记录（只读它有没有 `mediaModel`）。
 * @returns `{}`（没选过，字段不出现）或 `{ mediaModel }`（选了）。
 *
 * **不做 trim、不校验合法性**：写进来的那一笔已经在 `setMediaModel` 里归一过了，
 * 而这里每一次板面读取都要跑，重复归一等于给自己一个「两个地方都能改它」的错觉。
 */
export function mediaSlotOf(record: { readonly mediaModel?: string | undefined }): { mediaModel?: string } {
  return record.mediaModel === undefined ? {} : { mediaModel: record.mediaModel }
}

/**
 * 产物的真实宽高比，摊成可展开的片段（F3.11）。
 *
 * 与 {@link mediaSlotOf} 同一条纪律，但**不能合成一个**：它们的默认不同——模型「没选过」
 * 是交给配置去挑，比例「没量过」是卡片按默认 16:9 坐，而这两件事各自独立地发生在不同
 * 时刻（一张卡可以选了模型但还没量过比例）。
 *
 * @param record - 卡片记录（只读它有没有 `aspect`）。
 * @returns `{}`（没量过，字段不出现）或 `{ aspect }`。
 */
export function aspectSlotOf(record: { readonly aspect?: number | undefined }): { aspect?: number } {
  return record.aspect === undefined ? {} : { aspect: record.aspect }
}

/**
 * 这张卡设下的生成参数（媒体编辑台），摊成可展开的片段。
 *
 * 与 {@link mediaSlotOf} 同一条纪律，但**不能合成一个**：「没选过模型」与「没设过参数」
 * 是两次独立的写入，落在记录上也是两个独立的字段——合起来等于给「改参数必须重选模型」
 * 这类幽灵行为留门。
 *
 * 归一**不在这里做**：写进来的那一笔已经在 `setMediaParams` 里经过
 * `normalizeMediaParams`（全空即删除），所以这里读到 `undefined` 就只有一种意思——
 * 这张卡没有参数。
 */
export function paramsSlotOf(record: { readonly mediaParams?: MediaParams | undefined }): { mediaParams?: MediaParams } {
  return record.mediaParams === undefined ? {} : { mediaParams: record.mediaParams }
}
