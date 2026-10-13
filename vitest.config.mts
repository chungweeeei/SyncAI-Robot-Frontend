import { defineConfig } from "vitest/config";

/**
 * Unit tests only; `e2e/` is Playwright's and excluded.
 *
 * No `@vitejs/plugin-react`: esbuild already takes the JSX runtime from
 * tsconfig, and the plugin pulls a Babel 8 peer that collides with shadcn's
 * Babel 7. jsdom is the default so the few component tests need no per-file
 * override; pure code does not mind.
 */
export default defineConfig({
  // Vite 8 resolves tsconfig `paths` natively, hence no vite-tsconfig-paths.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
  },
});
