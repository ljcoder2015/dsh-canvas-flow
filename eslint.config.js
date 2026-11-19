import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // `lib/**` is build output. `.workbuddy/**` is project tooling and scratch
  // space (E2E probes, the dev-service home, memory notes) — Node-side scripts
  // that are not part of the plugin and are not written against these rules.
  { ignores: ['lib/**', 'node_modules/**', '.workbuddy/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
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
