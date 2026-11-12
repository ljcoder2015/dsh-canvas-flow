/**
 * skeleton2d 产物 v3（Rigby2D 外壳）的判据。
 *
 * v3 的红线都在归一这一道闸上：外壳三字段（format/texture/workfile）+ opaque 的 doc
 * 透传 + 随档文件不许穿越——写错一个不会报错，只会让编辑器开一份坏项目，所以全部钉死。
 * v1 轻模型走原归一（`model.spec.ts` 钉过），这里只钉「分派器不串档」。
 */
import { describe, expect, it } from 'vitest'
import {
  SKELETON2D_FORMAT,
  SKELETON2D_RIGBY_VERSION,
  isRigbyShell,
  normalizeSkeleton2dArtifact,
  serializeSkeleton2dShell,
} from '../../../src/core/skeleton2d/model.ts'

/** 一份最小可用的 v3 外壳。 */
function shellRaw(): Record<string, unknown> {
  return {
    format: SKELETON2D_FORMAT,
    version: SKELETON2D_RIGBY_VERSION,
    texture: '少女.png',
    workfile: '少女.rigby',
    doc: { meta: { name: '少女' } },
    files: { 'images/少女.png': 'aGVsbG8=' },
    prompt: '一句话',
  }
}

describe('v3 外壳：归一', () => {
  it('最小外壳归一通过，doc/files 原样透传（本仓不解读内部结构）', () => {
    const shell = normalizeSkeleton2dArtifact(shellRaw())
    expect(shell).toBeDefined()
    expect(isRigbyShell(shell!)).toBe(true)
    if (!isRigbyShell(shell!)) return
    expect(shell.texture).toBe('少女.png')
    expect(shell.workfile).toBe('少女.rigby')
    expect(shell.doc).toEqual({ meta: { name: '少女' } })
    expect(shell.files).toEqual({ 'images/少女.png': 'aGVsbG8=' })
    expect(shell.prompt).toBe('一句话')
  })

  it('外壳缺一不可：doc 不是对象 / workfile 空 / texture 空，整份拒绝', () => {
    for (const patch of [{ doc: 'not-an-object' }, { doc: [1, 2] }, { workfile: '' }, { texture: '' }]) {
      const raw = { ...shellRaw(), ...patch }
      expect(normalizeSkeleton2dArtifact(raw), JSON.stringify(patch)).toBeUndefined()
    }
  })

  it('随档文件的键不许穿越：.. 段、根相对前缀、空段，整份拒绝', () => {
    for (const key of ['../escape.png', '/abs.png', 'a//b.png', './x.png']) {
      const raw = shellRaw() as { files: Record<string, string> }
      raw.files = { [key]: 'aGVsbG8=' }
      expect(normalizeSkeleton2dArtifact(raw as unknown as Record<string, unknown>), key).toBeUndefined()
    }
  })

  it('随档文件值只收非空字符串（空串与数字都是坏数据）', () => {
    for (const value of ['', 42]) {
      const raw = shellRaw() as { files: Record<string, unknown> }
      raw.files = { 'images/少女.png': value }
      expect(normalizeSkeleton2dArtifact(raw as unknown as Record<string, unknown>), String(value)).toBeUndefined()
    }
  })

  it('version 3 缺 format 或换掉 format 都拒绝（不是我们的产物就不是我们的产物）', () => {
    expect(normalizeSkeleton2dArtifact({ ...shellRaw(), format: undefined })).toBeUndefined()
    expect(normalizeSkeleton2dArtifact({ ...shellRaw(), format: 'other' })).toBeUndefined()
  })

  it('序列化 → 归一 round-trip 逐字段相等，且 prompt 缺省是空串', () => {
    const shell = normalizeSkeleton2dArtifact({ ...shellRaw(), prompt: undefined })
    if (shell === undefined || !isRigbyShell(shell)) throw new Error('expected a rigby shell')
    const text = serializeSkeleton2dShell(shell)
    const again = normalizeSkeleton2dArtifact(JSON.parse(text) as Record<string, unknown>)
    expect(again).toEqual(shell)
  })
})

describe('分派器：v1 与 v3 不串档', () => {
  it('v1 轻模型（version 1）仍走原归一，得到的是轻模型不是外壳', () => {
    const model = normalizeSkeleton2dArtifact({ format: SKELETON2D_FORMAT, version: 1, texture: '少女.png' })
    expect(model).toBeDefined()
    expect(isRigbyShell(model!)).toBe(false)
    expect(model!.version).toBe(1)
  })

  it('version 缺席的旧产物照旧当 v1（生成侧还没落 v3，存量全在）', () => {
    const model = normalizeSkeleton2dArtifact({ format: SKELETON2D_FORMAT, texture: '少女.png' })
    expect(model).toBeDefined()
    expect(isRigbyShell(model!)).toBe(false)
  })

  it('未来的版本号（>3）如实拒绝，不猜', () => {
    expect(normalizeSkeleton2dArtifact({ ...shellRaw(), version: 4 })).toBeUndefined()
  })

  it('v1 归一的产物经序列化再回来仍是 v1（round-trip 不升档）', () => {
    const raw = { format: SKELETON2D_FORMAT, version: 1, texture: '少女.png', loop: 3 }
    const model = normalizeSkeleton2dArtifact(raw)
    expect(model).toBeDefined()
    if (isRigbyShell(model!)) return
    const again = normalizeSkeleton2dArtifact(JSON.parse(JSON.stringify(model)) as Record<string, unknown>)
    expect(isRigbyShell(again!)).toBe(false)
    expect(again).toEqual(model)
  })
})
