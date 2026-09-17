import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 15000,
    // E2E/ holds Playwright specs (run via `npm run test:e2e`), which
    // Vitest's default *.spec.ts glob would otherwise try to execute.
    exclude: [...configDefaults.exclude, 'E2E/**'],
  },
})
