import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real Next build, with the robot faked: every test
 * installs its own `**\/api/v1/**` routes (e2e/backend.ts), so a run is
 * deterministic and can hold states a robot will not (see CLAUDE.md > Tests).
 *
 * A production build rather than `next dev`, because dev compiles each route
 * on first request (a timeout on a cold cache) and the bundle is what ships.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts$/,
    },
    {
      name: "mobile",
      // A phone-sized Chromium, not an iPhone descriptor: those default to
      // WebKit, which CI does not install. iOS zoom-on-focus stays a manual
      // check on a real phone.
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /mobile\.spec\.ts$/,
    },
  ],
  webServer: {
    command: "npm run build && npm start",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: !process.env.CI,
    // A cold production build on a laptop is comfortably over the 60 s default.
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
