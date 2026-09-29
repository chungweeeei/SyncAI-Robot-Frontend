import { expect, test, type Page, type Route } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/**
 * The Settings header's restart: a press that rebuilds the robot's software,
 * whose outcome only the backend's restart record can report — the state
 * poll keeps answering with the last frame throughout.
 *
 * The console-error guard stays on, with one exception: a 409 makes Chromium
 * log "Failed to load resource", and here that refusal is the behaviour being
 * tested. A thrown render or a schema failure still fails the test.
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

  /**
   * Answer GET /robot/restart with `record` once it is set, standing in for
   * the robot reporting back when its rebuild is over.
   */
  async function finishRestartWith(page: Page) {
    const finish: { record: Record<string, unknown> | null } = { record: null };
    await page.route("**/api/v1/robot/restart", (route: Route) =>
      route.request().method() === "GET" && finish.record
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(finish.record),
          })
        : route.fallback(),
    );
    return finish;
  }

  async function confirmRestart(page: Page) {
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Restart" }).click();
    return dialog;
  }

  test("confirms, restarts, and says so when the robot reports back", async ({
    page,
  }) => {
    const writes = await mockBackend(page);
    const finish = await finishRestartWith(page);

    await page.goto("/settings");
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("stops navigating for about 30");

    // Nothing is sent until the operator confirms.
    expect(writes.filter((w) => w.path === "/api/v1/robot/restart")).toEqual([]);
    await dialog.getByRole("button", { name: "Restart" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();
    await expect(restartButton(page)).toBeDisabled();
    expect(
      writes.filter((w) => w.method === "POST" && w.path === "/api/v1/robot/restart"),
    ).toHaveLength(1);

    finish.record = {
      status: "succeeded",
      message: "Restarted AUTO (session auto)",
      started_at: "2026-09-18T09:45:00Z",
      finished_at: "2026-09-18T09:45:31Z",
    };
    // The console's own word, not the robot's sentence naming its session.
    await expect(page.getByText("Restarted.", { exact: true })).toBeVisible();
    await expect(page.getByText(/session auto/)).toHaveCount(0);
    await expect(restartButton(page)).toBeEnabled();
  });

  test("shows the robot's sentence when the rebuild fails", async ({ page }) => {
    await mockBackend(page);
    const finish = await finishRestartWith(page);

    await page.goto("/settings");
    await confirmRestart(page);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();

    const reason = "The robot did not report back from the restart. Check that it is running, then try again.";
    finish.record = {
      status: "failed",
      message: reason,
      started_at: "2026-09-18T09:45:00Z",
      finished_at: "2026-09-18T09:48:01Z",
    };
    await expect(page.getByText(reason)).toBeVisible();
    await expect(restartButton(page)).toBeEnabled();
  });

  test("shows a restart another console started, and holds the button", async ({
    page,
  }) => {
    await mockBackend(page, {
      restart: {
        status: "restarting",
        message: "",
        started_at: "2026-09-18T09:45:00Z",
        finished_at: null,
      },
    });
    await page.goto("/settings");

    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();
    await expect(restartButton(page)).toBeDisabled();
  });

  test("does not announce an old restart's outcome on arrival", async ({ page }) => {
    // Another console's restart, finished before this one opened Settings:
    // the operator here did not ask, so there is nothing to tell them.
    await mockBackend(page, {
      restart: {
        status: "failed",
        message: "Tried to restart AUTO but ended up in MAINTENANCE",
        started_at: "2026-09-18T09:00:00Z",
        finished_at: "2026-09-18T09:00:40Z",
      },
    });
    await page.goto("/settings");

    await expect(restartButton(page)).toBeEnabled();
    await expect(page.getByText(/ended up in MAINTENANCE/)).toHaveCount(0);
  });

  test("shows the robot's refusal and does not claim a restart", async ({
    page,
  }) => {
    await mockBackend(page);
    const refusal = "The robot cannot restart right now: both stacks are up.";
    await page.route("**/api/v1/robot/restart", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal, code: "restart_refused" }),
          })
        : route.fallback(),
    );

    await page.goto("/settings");
    const dialog = await confirmRestart(page);

    // The backend's sentence, verbatim, in the dialog that is still open.
    await expect(dialog.getByRole("alert")).toHaveText(refusal);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toHaveCount(0);

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
