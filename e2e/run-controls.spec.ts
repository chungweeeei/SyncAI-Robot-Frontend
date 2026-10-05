import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  taskState,
} from "./backend";

/**
 * The masthead's running-job controls: the step readout and the hold,
 * release and cancel beside it. Each test asserts both halves — what the
 * strip says and what the console sent — because a pause is a request the
 * robot acts on when it can, and the screen must say which of the two it is
 * showing. The strip is the page's `<header>`, so `banner` scopes every
 * locator to it and away from the /tasks banner's own Cancel.
 *
 * The console-error guard stays on, with the exception settings.spec.ts
 * records: a 409 or a 502 makes Chromium log "Failed to load resource", and
 * here that refusal is the behaviour being tested. A thrown render or a
 * schema failure still fails the test.
 */

const ID = "robot01-task-1758000000-1";

const strip = (page: Page) => page.getByRole("banner");
const readout = (page: Page) => strip(page).getByRole("status");
const pauseButton = (page: Page) =>
  strip(page).getByRole("button", { name: "Pause the job" });
const resumeButton = (page: Page) =>
  strip(page).getByRole("button", { name: "Resume the job" });
const cancelButton = (page: Page) =>
  strip(page).getByRole("button", { name: "Cancel the job" });

test.describe("the running-job controls", () => {
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

  test("says the queue is empty while the robot is idle, in so many words", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings");

    // The bar is drawn in every state: an empty slot is also what a readout
    // that failed to render looks like, so idle has to say that it is idle.
    // Both controls stay in the row and are out, so nothing moves under a
    // finger when a job starts.
    await expect(strip(page).getByText("Navigation")).toBeVisible();
    await expect(readout(page)).toContainText("No task message in queue");
    await expect(pauseButton(page)).toBeDisabled();
    await expect(cancelButton(page)).toBeDisabled();
  });

  test("names the step the robot is on, from the run's own read", async ({
    page,
  }) => {
    // /active_tasks carries no steps; the readout comes from GET /tasks/<id>.
    await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");

    await expect(readout(page)).toContainText("2/3");
    await expect(readout(page)).toContainText("Speak");
    // The job's name is one hover away rather than in the row.
    await expect(
      strip(page).getByRole("link", { name: "Morning round — open the job list" }),
    ).toBeVisible();
    await expect(pauseButton(page)).toBeEnabled();
    await expect(cancelButton(page)).toBeEnabled();
  });

  test("pauses against the run's id and reads the hold back, not the ack", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");
    await expect(readout(page)).toContainText("Speak");

    await pauseButton(page).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);
    expect(writes[0].path).toBe(`/api/v1/tasks/${ID}/pause`);
    // The fake flips the run's state on the pause, so the next read says
    // PAUSED and the button turns into Resume. "Paused" is the reading; the
    // ack's PAUSING is never shown as it.
    await expect(readout(page)).toContainText("Paused");
    await expect(resumeButton(page)).toBeEnabled();
    await expect(pauseButton(page)).toHaveCount(0);
  });

  test("resumes a held run and the readout returns to the step", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: {
        [ID]: taskState({
          status: "PAUSED",
          steps: [
            { id: "1-move", status: "COMPLETED", error_msg: "" },
            { id: "2-move", status: "PAUSED", error_msg: "" },
            { id: "3-speak", status: "PENDING", error_msg: "" },
          ],
        }),
      },
    });
    await page.goto("/settings");
    await expect(readout(page)).toContainText("Paused");

    await resumeButton(page).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);
    expect(writes[0].path).toBe(`/api/v1/tasks/${ID}/resume`);
    await expect(readout(page)).not.toContainText("Paused");
    await expect(readout(page)).toContainText("2/3");
    await expect(pauseButton(page)).toBeEnabled();
  });

  test("renders the backend's refusal verbatim and keeps the controls", async ({
    page,
  }) => {
    await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    // Registered after mockBackend, so it wins: the run closed between the
    // list's read and the press.
    await page.route(`**/api/v1/tasks/${ID}/pause`, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: `Task ${ID} is not running`,
          code: "task_not_running",
        }),
      }),
    );
    await page.goto("/settings");

    await pauseButton(page).click();

    await expect(strip(page).getByRole("alert")).toHaveText(
      `Task ${ID} is not running`,
    );
    await expect(pauseButton(page)).toBeEnabled();
    await expect(cancelButton(page)).toBeVisible();
  });

  test("offers no hold on a posture, only a cancel", async ({ page }) => {
    // A Stand is one posture step, which a pause does not interrupt and
    // after which there is no next step to hold before.
    await mockBackend(page, {
      activeTasks: [activeTask({ kind: "standup", name: null, map_name: null })],
      taskStates: {
        [ID]: taskState({
          steps: [{ id: "standup", status: "IN_PROGRESS", error_msg: "" }],
        }),
      },
    });
    await page.goto("/settings");

    // Greyed rather than gone: the pair is a fixed cluster, and a Pause that
    // dropped out would slide Cancel under a finger already on its way to it.
    await expect(readout(page)).toContainText("Stand");
    await expect(pauseButton(page)).toBeDisabled();
    await expect(resumeButton(page)).toHaveCount(0);
    await expect(cancelButton(page)).toBeEnabled();
  });

  test("cancels against the run's id from any screen", async ({ page }) => {
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/history");

    await cancelButton(page).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe(`/api/v1/tasks/${ID}`);
  });

  test("empties with the run, and never draws a failing list as idle", async ({
    page,
  }) => {
    const running = [activeTask()];
    await mockBackend(page, {
      activeTasks: running,
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");
    await expect(readout(page)).toContainText("2/3");

    running.length = 0;
    await expect(readout(page)).toContainText("No task message in queue");
    await expect(cancelButton(page)).toBeDisabled();

    // The distinction the bar exists to keep: "there is no job" and "the
    // console cannot tell" are different sentences, and the second must
    // never be drawn as the first.
    await page.route("**/api/v1/active_tasks", (route) =>
      route.fulfill({ status: 502, body: "" }),
    );
    await expect(readout(page)).toContainText("Job list unavailable");
  });
});
