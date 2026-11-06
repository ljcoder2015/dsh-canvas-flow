/**
 * dsh-canvas — 一次生成多张时，第 N 张产物落在哪里。
 *
 * 画布的模型是**一卡一产物**：卡片记录上的 `file` 只有一个值。生成数量 > 1 时，第一张
 * 照旧落进卡片自己的产物路径，第 2..N 张落在同目录、同词干、加序号的兄弟路径上
 * （`images/cover.png` 的第 2 张是 `images/cover-2.png`）——产物目录归扫描建卡管
 * （`scanProject`），所以它们稍后会在画布上以自己的卡出现，而不必在这里发明
 * 「一张卡多张图」这种记录层没有的形状。
 *
 * 纯函数：不认识 io、不认识卡片。序号从 2 起——1 就是本名，不需要后缀。
 */

/**
 * `file` 的第 `index` 张兄弟路径。保留目录与扩展名，只在词干上加 `-<index>`；
 * 没有扩展名的名字（面板产物之外的裸路径）同样成立——没有点可拆就不拆。
 */
export function siblingPathOf(file: string, index: number): string {
  const dot = file.lastIndexOf('.')
  const slash = file.lastIndexOf('/')
  // 点在最后一个分隔符之前（或不存在）说明它属于目录名，不是扩展名——`my.dir/cover` 的点不动。
  const hasExtension = dot > slash
  const stem = hasExtension ? file.slice(0, dot) : file
  const extension = hasExtension ? file.slice(dot) : ''
  return `${stem}-${index}${extension}`
}
