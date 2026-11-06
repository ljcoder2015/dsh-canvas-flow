/**
 * dsh-canvas — 本地字体那条路由的地址（v1.89）。
 *
 * 一份地址、三处消费：宿主注册路由（`host/fonts.ts`）、引擎 chunk 取字面
 * （`design-host-fonts.ts`）、面板取族名清单（`design-local-fonts.ts`）。各写一遍的后果
 * 不是编译错，而是**其中一处 404**——面板里有那一族，画布上却永远挑不到字面。
 *
 * 所以这个模块零依赖、只放字符串与拼法：宿主与客户端读的是同一份。
 */
export const FONT_ROUTE = '/dsh-canvas/fonts'

/** 族名与字重清单。 */
export const FONT_LIST_URL = `${FONT_ROUTE}/list`

/**
 * 取一张脸的文件字节。
 *
 * 参数是**族名**与**字重名**（`Regular` / `Bold`），不是路径也不是序号：路由那边只拿它们
 * 去查自己扫出来的那张表，请求里的任何字符串都不会变成文件系统路径。
 */
export function fontFileUrl(family: string, style: string): string {
  return `${FONT_ROUTE}/file?family=${encodeURIComponent(family)}&style=${encodeURIComponent(style)}`
}
