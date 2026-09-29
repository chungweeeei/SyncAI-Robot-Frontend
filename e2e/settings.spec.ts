import { expect, test, type Page } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/**
 * The Settings header's restart: a press that takes the robot's software —
 * and this console's link — down on purpose, and has to read as that rather
 * than as a fault.
 *
 * The console-error guard stays on, with one exception: a request that fails
 * at the network or answers 409 makes Chromium log "Failed to load resource",
 * and here that failure is the behaviour being tested. A thrown render or a
 * schema failure still fails the test.
 */
test.describe("restarting the robot from Settings", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  const restartButton = (page: Page) =>
    page.getByRole("button", { name: "Restart robot" });
  const underWay = (page: Page) =>
    page.getByText("Restarting. This console reconnects on its own.");

  test("confirms, restarts, and reports it until the link comes back", async ({
    page,
  }) => {
    const writes = await mockBackend(page);

    // The usual outcome: the backend dies before it answers, so the POST's
    // connection drops, and the state poll fails until the stack is back.
    let down = false;
    await page.route("**/api/v1/robot/restart", async (route) => {
      writes.push({ method: "POST", path: "/api/v1/robot/restart", body: null });
      down = true;
      await route.abort("connectionreset");
    });
    await page.route("**/api/v1/robot/state", (route) =>
      down ? route.abort("connectionrefused") : route.fallback(),
    );

    await page.goto("/settings");
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("loses contact for about 30 seconds");

    // Nothing is sent until the operator confirms.
    expect(writes.filter((w) => w.path === "/api/v1/robot/restart")).toEqual([]);
    await dialog.getByRole("button", { name: "Restart" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(underWay(page)).toBeVisible();
    await expect(restartButton(page)).toBeDisabled();
    expect(
      writes.filter((w) => w.path === "/api/v1/robot/restart"),
    ).toHaveLength(1);

    // Wait for the poll to have actually failed at least once, then bring the
    // stack back: the hint clears on the first frame after the drop.
    await expect(page.getByText("Last seen")).toBeVisible();
    down = false;
    await expect(underWay(page)).toHaveCount(0);
    await expect(restartButton(page)).toBeEnabled();
  });

  test("shows the robot's refusal and does not claim a restart", async ({
    page,
  }) => {
    await mockBackend(page);
    const refusal = "The robot cannot restart right now: both stacks are up.";
    await page.route("**/api/v1/robot/restart", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: refusal, code: "restart_refused" }),
      }),
    );

    await page.goto("/settings");
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Restart" }).click();

    // The backend's sentence, verbatim, in the dialog that is still open.
    await expect(dialog.getByRole("alert")).toHaveText(refusal);
    await expect(underWay(page)).toHaveCount(0);

    // And it is gone when the dialog is opened again.
    await dialog.getByRole("button", { name: "Keep running" }).click();
    await restartButton(page).click();
    await expect(page.getByRole("alertdialog").getByRole("alert")).toHaveCount(0);
  });

  test("warns that a running job will stop", async ({ page }) => {
    await mockBackend(page, {
      activeTasks: [
        {
          id: "robot01-task-1758000000-1",
          run_id: "run-1",
          status: "IN_PROGRESS",
          started_at: "2026-09-18T09:40:00Z",
          source: "DIRECT",
          schedule_id: null,
        },
      ],
    });
    await page.goto("/settings");
    await restartButton(page).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "running a job, and restarting stops it",
    );
  });

  test("cannot be pressed in Mapping, and says why", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: robotState({ mode: "MANUAL" }),
    });
    await page.goto("/settings");

    await expect(restartButton(page)).toBeDisabled();
    await expect(restartButton(page)).toHaveAccessibleDescription(
      /Available in Navigation/,
    );
    expect(writes.filter((w) => w.path === "/api/v1/robot/restart")).toEqual([]);
  });
});
