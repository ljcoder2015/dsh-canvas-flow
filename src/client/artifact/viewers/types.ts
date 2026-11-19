/**
 * dsh-canvas — 预览器的公共契约。
 *
 * 一个产物在弹窗里长什么样由它的 kind 决定（`../registry.ts` 那张表），而这个文件只放
 * 那张表要传递的东西：viewer 的 id、它认领哪些 kind、以及它收到的 props。
 *
 * **能力不在这里。** 一个预览器能做什么——能不能就地改文本、有没有一个能对话的页面帧、
 * 将来还会有的别的——不由它声明，而由它的组件自己做：按钮挂进弹窗的插槽（`../chrome.tsx`）、
 * 状态与判断留在它自己的文件里。声明与实现分家的那版里，「加一种形态」还是得回弹窗外壳
 * 改几处 `if`；现在外壳压根不知道有哪些按钮。
 *
 * 单独成一个文件是因为**两头都要它**：每个 viewer 子文件要实现它，注册表与模态要引用它，
 * 而它本身零依赖（两个类型导入都是 type-only），所以谁都不会为了拿一个类型而把别人拖进来。
 */
import type { ComponentType } from 'react'
import type { ArtifactView } from '../../../types.ts'
import type { Translate } from '../../ui/locales.ts'

/** The viewer ids the registry can hand out — stable strings, testable pure. */
export type ViewerId = 'markdown' | 'image' | 'deck' | 'data' | 'video' | 'audio' | 'text' | 'design'

/** Props every kind viewer receives. 其余的一切（桥、插槽、归属）走 `useChrome()`。 */
export interface ViewerProps {
  view: ArtifactView
  t: Translate
}

/**
 * 一条预览器注册项 —— 注册表（`../registry.ts`）的一行。
 *
 * 一行只说一件事：**这个预览器认领哪些 kind**。以前它还带着两条能力谓词（「能不能就地
 * 编」「有没有能对话的页面帧」），那是把「能力」写在一处、把「界面」长在另一处：外壳查表
 * 之后替预览器把按钮画出来，于是按钮长什么样、什么时候出现，都得回外壳改。现在那两件事
 * 都由预览器自己在组件里做（`editing/`、`element-pick/`），注册表回到一行一句。
 *
 * 加一个预览器 = 加一个文件（里面连注册项一起写）+ 在注册表里 import 一行。
 */
export interface ViewerRegistration {
  /** 这个预览器的稳定 id。 */
  readonly id: ViewerId
  /** 画它的组件。 */
  readonly component: ComponentType<ViewerProps>
  /**
   * 认领哪些 kind。
   *
   * 是**谓词**而不是清单：兜底的那一条要认领「其余一切」，而 kind 的集合是开放的（宿主的
   * 形态注册表可以加新条目），列不完。
   */
  readonly claims: (kind: string) => boolean
  /**
   * 兜底条目：上面没人认领的 kind 归它。
   *
   * 标出来而不是靠「排在最后」，因为顺序是看不见的约定——注册表重排一次就会静默地把兜底
   * 挪到前面，把每个 kind 都截走。装配的可查性是测试钉住的。
   */
  readonly fallback?: boolean
}
