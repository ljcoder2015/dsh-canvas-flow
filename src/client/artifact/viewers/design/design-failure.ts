/**
 * dsh-canvas — 引擎侧「画不出来」的那次失败（F10.1 导出）。
 *
 * 引擎 chunk（`design-io.ts` / `design-pdf.ts`）里的四个已知失败点不抛裸中文：它们带
 * **码**（`DesignExportFailureCode`）与那个**名字**（哪个容器/页面），`design-io.ts` 的
 * 收口把它转成 `DesignExportOutcome` 的 `error` 分支交回 client——界面文案由客户端按码
 * 出（`locales.ts` 的 `canvas.export.design*`），与 `import-plan.ts` 的「宿主报枚举、
 * 客户端出文案」是同一条分工。`message` 只作诊断回退（客户端按码映射时读不到它）。
 *
 * 这个模块是零依赖的运行时代码：两侧都**真 import**（不是 `import type`），因为
 * `instanceof` 判据必须在两侧认同一个类。
 */
import type { DesignExportFailureCode } from './design-engine-types.ts'

export class DesignExportFailure extends Error {
  readonly code: DesignExportFailureCode
  /** 画不出来的那个容器/页面名；与名字无关的失败（没页面、取不到字面）给空串。 */
  readonly unit: string

  constructor(code: DesignExportFailureCode, unit = '') {
    super(unit === '' ? `design export failed: ${code}` : `design export failed: ${code} (${unit})`)
    this.code = code
    this.unit = unit
  }
}
