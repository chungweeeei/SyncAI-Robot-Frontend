import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  robotState,
  taskState,
} from "./backend";

/**
 * The masthead's emergency stop — the driver's safety lock: one press
 * engages it, only a held press releases it, and what the button shows is
 * the lock the robot reports. Each test asserts both halves — what the strip says and what
 * the console sent — and every "nothing happened" carries a positive control,
 * because a button that never received the press also leaves the stop where
 * it was.
 */

const ID = "robot01-task-1758000000-1";

const strip = (page: Page) => page.getByRole("banner");
const stopButton = (page: Page) =>
  strip(page).getByRole("button", { name: /^Emergency stop/ });

/** Press the stop with the mouse and hold it for `ms`. */
async function holdStop(page: Page, ms: number) {
  const box = await stopButton(page).boundingBox();
  if (!box) throw new Error("the stop is not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe("the emergency stop", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  // A 502 makes Chromium log "Failed to load resource", and one test here
  // answers the lock with exactly that on purpose (run-controls.spec.ts
  // records the same exception). A thrown render still fails.
  test.afterEach(() => {
    expect(
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  test("one press locks the robot and leaves the cancels to it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(strip(page).getByRole("status")).toContainText("2/3");

    await stopButton(page).click();

    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({
      method: "POST",
      path: "/api/v1/robot/estop",
      body: { locked: true },
    });
    // The backend cancels every job on the lock's edge, so the console sends
    // no DELETE of its own — and the run leaving the list is how it shows.
    await expect(strip(page).getByRole("status")).toHaveText(
      "No task message in queue",
    );
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
  });

  test("puts the press back and says why when the lock is refused", async ({
    page,
  }) => {
    await mockBackend(page);
    // Registered after the fake, so it answers first.
    await page.route("**/api/v1/robot/estop", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "The robot's driver did not answer." }),
      }),
    );
    await page.goto("/settings");

    await stopButton(page).click();

    // Nothing was locked, so the controls are not held — but the sentence is
    // on the button for whoever asks, never as a line under the strip.
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(stopButton(page)).toHaveAccessibleDescription(
      "The robot's driver did not answer.",
    );
    await expect(strip(page).getByRole("alert")).toHaveCount(0);
  });

  test("a tap does not release it; a held press does", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings");

    await stopButton(page).click();
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");

    // A second tap, and a press let go early: both leave it engaged, and
    // neither sends a release.
    await stopButton(page).click();
    await holdStop(page, 300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    expect(writes.map((w) => w.body)).toEqual([{ locked: true }]);

    // Positive control: the same press held past the second releases it.
    await holdStop(page, 1300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    expect(writes.map((w) => w.body)).toEqual([{ locked: true }, { locked: false }]);
  });

  test("Shift+Space engages it from anywhere on the page", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings");

    await page.keyboard.press("Shift+Space");

    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/robot/estop"))
      .toHaveLength(1);
  });

  test("disarms manual drive and keeps it disarmed until released", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings");
    await strip(page).getByRole("button", { name: "Manual drive panel" }).click();
    const arm = page.getByRole("switch", { name: "Arm manual drive input" });

    // Positive control: the switch arms before the stop.
    await arm.click();
    await expect(arm).toHaveAttribute("aria-checked", "true");

    await stopButton(page).click();
    await expect(arm).toHaveAttribute("aria-checked", "false");
    await expect(arm).toHaveAttribute("aria-disabled", "true");

    // Released, it may be armed again — but it was not re-armed for us.
    await holdStop(page, 1300);
    await expect(arm).toHaveAttribute("aria-checked", "false");
    await arm.click();
    await expect(arm).toHaveAttribute("aria-checked", "true");
  });

  test("shows a lock the robot reports, and releases it from here", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: robotState({
        low_level_mode: { policy: "PPO", motion: "LOCOMOTION", safety_locked: true },
      }),
    });
    await page.goto("/settings");

    // Engaged by another console or the driver: this tab pressed nothing.
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await stopButton(page).click();
    expect(writes).toEqual([]);

    // The lock is the driver's, so a release from here is a real one.
    await holdStop(page, 1300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    expect(writes.map((w) => w.body)).toEqual([{ locked: false }]);
  });
});
