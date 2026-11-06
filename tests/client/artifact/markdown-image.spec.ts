/**
 * markdown 图片引用的换写（v1.92 图文并茂）：这三类去向——原样放行、换写成工作区
 * 路由、拒绝——判错了都不会报错，只会是破图或者一条脚本信道，所以钉在纯函数上。
 *
 * node 环境里 `globalThis.location` 不存在，`hostBase()` 退到固定主机名，所以 URL
 * 断言是确定性的。
 */
import { describe, expect, it } from 'vitest'
import { markdownImageSrc } from '../../../src/client/artifact/viewers/markdown-image.ts'

const BASE = 'http://dsh.internal'

describe('markdownImageSrc', () => {
  it('passes remote and inline images through unchanged', () => {
    expect(markdownImageSrc('p1', 'docs/a.md', 'https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(markdownImageSrc('p1', 'docs/a.md', 'http://example.com/a.png')).toBe('http://example.com/a.png')
    expect(markdownImageSrc('p1', 'docs/a.md', 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })

  it('resolves a relative reference against the artifact directory onto the workspace route', () => {
    expect(markdownImageSrc('p1', 'docs/report.md', 'cover.png')).toBe(
      `${BASE}/dsh-canvas/workspace/p1/docs/cover.png`,
    )
    expect(markdownImageSrc('p1', 'docs/report.md', 'assets/fig 1.png')).toBe(
      `${BASE}/dsh-canvas/workspace/p1/docs/assets/fig%201.png`,
    )
    // `..` 上收一段：图在产物目录的旁边，不在里面。
    expect(markdownImageSrc('p1', 'docs/report.md', '../images/fig-1.png')).toBe(
      `${BASE}/dsh-canvas/workspace/p1/images/fig-1.png`,
    )
  })

  it('treats a leading slash as project-root relative', () => {
    expect(markdownImageSrc('p1', 'docs/report.md', '/images/cover.png')).toBe(
      `${BASE}/dsh-canvas/workspace/p1/images/cover.png`,
    )
  })

  it('refuses references that escape the project root', () => {
    expect(markdownImageSrc('p1', 'report.md', '../../outside.png')).toBeUndefined()
    expect(markdownImageSrc('p1', 'docs/report.md', '../../../outside.png')).toBeUndefined()
  })

  it('refuses every scheme that is not an image source', () => {
    // 渲染器还有构造闸，但这里的答案本身就是「不渲染」：脚本协议不是插图。
    expect(markdownImageSrc('p1', 'a.md', 'javascript:alert(1)')).toBeUndefined()
    expect(markdownImageSrc('p1', 'a.md', 'data:text/html,<script>1</script>')).toBeUndefined()
    expect(markdownImageSrc('p1', 'a.md', 'file:///etc/passwd.png')).toBeUndefined()
    expect(markdownImageSrc('p1', 'a.md', '')).toBeUndefined()
  })

  it('encodes the projectId and every path segment separately', () => {
    // projectId 是铸造的座位 id，路径段各编各的码——整条一起编会把 `/` 也吃掉。
    expect(markdownImageSrc('ab cd', 'docs/a.md', 'x.png')).toBe(
      `${BASE}/dsh-canvas/workspace/ab%20cd/docs/x.png`,
    )
  })
})
