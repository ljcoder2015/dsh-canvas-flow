/**
 * 多张产物的兄弟路径（生成数量 > 1 的落点）。
 *
 * 一卡一产物是记录层的形状，多张的第二张起落在「同目录、同词干、加序号」的兄弟路径上。
 * 这条判据失守的表现不是报错，是产物写到想不到的地方：把扩展名拆错（`my.dir/cover` 的点
 * 属于目录名）或者干脆盖掉第一张。
 */
import { describe, expect, it } from 'vitest'
import { siblingPathOf } from '../../../../src/core/canvas/card/sibling-path.ts'

describe('siblingPathOf', () => {
  it('保留目录与扩展名，只在词干上加序号', () => {
    expect(siblingPathOf('images/cover.png', 2)).toBe('images/cover-2.png')
    expect(siblingPathOf('cover.png', 4)).toBe('cover-4.png')
  })

  it('没有扩展名的名字同样成立；目录名里的点不是扩展名', () => {
    expect(siblingPathOf('images/cover', 3)).toBe('images/cover-3')
    expect(siblingPathOf('my.dir/cover', 2)).toBe('my.dir/cover-2')
  })
})
