import { defineConfig } from "vitest/config";

/**
 * Unit tests. The e2e suite is Playwright's and lives in `e2e/`, which is
 * excluded here so `vitest` does not try to run a `@playwright/test` file.
 *
 * `@vitejs/plugin-react` is deliberately absent. Its only jobs here would be
 * Fast Refresh, which a test run has no use for, and the automatic JSX
 * runtime, which Vite's esbuild already takes from `jsx: "react-jsx"` in
 * tsconfig.json. Installing it pulls a Babel 8 peer that collides with the
 * Babel 7 shadcn brings, and paying a dependency conflict for nothing is how
 * a test setup starts being something people avoid touching.
 *
 * `environment: "jsdom"` is the default because the few component tests need a
 * DOM and a per-file override is one more thing to remember. Nearly everything
 * worth testing here is pure, and pure code does not mind.
 */
export default defineConfig({
  // Vite 8 resolves tsconfig `paths` natively; vite-tsconfig-paths is not
  // installed for this reason.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
