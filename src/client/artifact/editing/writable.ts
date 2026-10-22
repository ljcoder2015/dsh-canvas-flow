/**
 * dsh-canvas — 这份产物能不能整篇写回（F3.12）。
 *
 * 就地编辑是「把整个文件换成编辑器里的文字」，所以它成立的前提只有一条：**产物的字节
 * 就是它的文字**。kind 说得出前半句（`isDirectTextKind`，宿主那张 kind 表上的事实），
 * payload 说得出后半句（它在、而且读全了）—— 两半都成立，编辑钮才该出现。
 *
 * 单独成文件是为了能单测：这条判定要是散在 hook 里，就只有起一个真浏览器才知道它还
 * 会不会给出一枚「点下去就把文件改成别的东西」的按钮。
 */
import { isDirectTextKind } from '../../../core/artifact/kind/kind-registry.ts'
import type { ArtifactView } from '../../../types.ts'

/** 这份 payload 能不能整篇写回（见文件头）。读了一半的文件绝不算：写回去的会是那半份。 */
export function writablePayload(view: Pick<ArtifactView, 'kind' | 'present' | 'truncated'>): boolean {
  return view.present && !view.truncated && isDirectTextKind(view.kind)
}

/**
 * 打开编辑面时，要不要先替这张卡落一份空白文本（F3.12 × F3.14）。
 *
 * 「手动输入」是对**文本卡片**说的：产物就是它自己的文字，用户点它的意思就是「我要写
 * 字」。而一个座位可以先于它的产物存在（F1.11）——建卡铸名那一刻 `文本1.md` 只是名字，
 * 盘上还没有这个文件。少了这一条，这枚按钮点下去只会得到一句「产物不存在」，一条本该
 * 通向写作的路就断在门口（产物被删掉之后再想手写回来，同样断在这里）。
 *
 * 三条同时成立才落空白，每条都拦掉一种不该发生的写：
 *
 * - **从「手动输入」进来的**。看一眼预览不该把文件写出来——那是把「读」变成了「写」。
 * - **产物确实不在**。空文件是**在**的：那是用户自己清空的结果，不是我们要补的缺。
 * - **形态就是它自己的文字**。给图片、Deck、目录补一份空文本，等于把文件改成文本。
 */
export function needsBlankText(view: Pick<ArtifactView, 'kind' | 'present'>, openInEditor: boolean): boolean {
  return openInEditor && !view.present && isDirectTextKind(view.kind)
}
