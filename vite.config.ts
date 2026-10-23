import * as Path from 'node:path'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    // Longer specifiers come first, since the bare `handshakes` pattern is anchored.
    alias: [
      {
        find: 'handshakes/better-auth',
        replacement: Path.resolve(import.meta.dirname, 'src/better-auth/index.ts'),
      },
      {
        find: 'handshakes/node',
        replacement: Path.resolve(import.meta.dirname, 'src/node/index.ts'),
      },
      {
        find: 'handshakes/test',
        replacement: Path.resolve(import.meta.dirname, 'src/test/index.ts'),
      },
      { find: /^handshakes$/, replacement: Path.resolve(import.meta.dirname, 'src/index.ts') },
    ],
    globals: true,
  },
  lint: {
    ignorePatterns: ['dist/**'],
    // TypeScript runs separately through `pnpm check:types`.
    options: {
      typeAware: false,
      typeCheck: false,
    },
  },
  fmt: {
    ignorePatterns: ['dist/**'],
    printWidth: 100,
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
  },
})
