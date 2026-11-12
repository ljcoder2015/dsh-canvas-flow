import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // vendor/**（Rigby2D 上游，见 vendor/rigby2d/FORK.md）自带一套 `node --test`
    // 的判据，跑法与依赖都归上游——本仓的 vitest 不替它跑，也不因它红。
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-embed/**', 'vendor/**'],
  },
})
