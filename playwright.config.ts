import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a real Next build, with the robot faked.
 *
 * **There is no robot here, and that is the design.** Every test installs its
 * own `**\/api/v1/**` routes (see e2e/backend.ts), so a run is deterministic,
 * works on a laptop with nothing else running, and can put the console in
 * states a real robot will not hold still in — mid-conversion, unlocalized,
 * a task that fails on its third step. What it cannot cover is whether the
 * backend actually answers in these shapes; that is what the zod schemas and
 * the backend's own tests are for, and the fixtures here are written from the
 * same interfaces those schemas mirror.
 *
 * `npm run build && npm start` rather than `next dev`: the dev server
 * recompiles a route on first request, which turns the first navigation of
 * every file into a timeout on a cold cache, and the production bundle is what
 * actually ships to the robot.
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
      // A phone-sized Chromium rather than devices["iPhone 13"]: every iPhone
      // descriptor defaults to WebKit, which CI does not install (see
      // ci.yml), and what this project checks — layout at 375 px and touch
      // pointer events — Chromium can stand in for. What it cannot stand in
      // for is iOS zoom-on-focus, which stays a manual check on a real phone.
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
