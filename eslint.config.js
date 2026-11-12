import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `lib/**` is build output. `.workbuddy/**` is project tooling and scratch
  // space (E2E probes, the dev-service home, memory notes) — Node-side scripts
  // that are not part of the plugin and are not written against these rules.
  // `vendor/**`（Rigby2D 上游）按它自己的规矩活（FORK.md），本仓 lint 不扫。
  { ignores: ['lib/**', 'node_modules/**', '.workbuddy/**', 'vendor/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `rigby2d-build.mjs`（骨骼动画卡 v2.08）：跑在 Node 上的构建步——vendor 的 vite
    // 调用与产物搬运，console/process 是它的正常词汇，与本仓其余源码不同族。
    files: ['rigby2d-build.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    rules: {
      // A Typert Remote namespace face is declared by extending the interface
      // the generated hex-named class represents (`interface
      // TypertRemoteNamespace$63616e766173 extends CanvasFace {}`) — the name
      // is the wire identity and the body is the shared face, so the empty
      // extension is the idiom, not an accident.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
)
