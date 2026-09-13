import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The suite is exactly `tests/*.test.ts`. Scoped explicitly because the
    // gitignored real-site fixtures under `examples/` carry their own vitest
    // and Playwright specs, and vitest's default include would sweep them into
    // this run — a fixture's failing spec is not a failure of this package.
    include: ['tests/**/*.test.ts'],
  },
})
