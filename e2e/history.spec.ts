import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  failOnConsoleErrors,
  mockBackend,
  taskHistoryEntry,
} from "./backend";

/**
 * The job history: the dashboard, its filters and paging.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
test.describe("the job history", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
    // The default window reaches back a day from now, and the fixture's jobs
    // closed on 2026-09-18; a real clock would have aged them out of it.
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  const finished = [
    taskHistoryEntry(),
    taskHistoryEntry({
      id: "nightly-2026-09-18T01:00:00Z",
      run_id: "run-2",
      status: "FAILED",
      started_at: "2026-09-18T01:00:00Z",
      closed_at: "2026-09-18T01:12:30Z",
      source: "SCHEDULE",
      schedule_id: "nightly",
      kind: "schedule",
      name: "Morning round",
    }),
  ];

  /** A dashboard tile's number, by its label. */
  const tile = (dashboard: Locator, label: string) =>
    dashboard
      .locator("dt", { hasText: label })
      .locator("xpath=following-sibling::dd[1]");

  /** The two reads one filter makes, as the fake saw them. */
  const historyReads = (
    page: Page,
    match: (params: URLSearchParams) => boolean,
  ) =>
    Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history" && match(url.searchParams)
        );
      }),
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history/stats" &&
          match(url.searchParams)
        );
      }),
    ]);

  test("lists each job by its name or kind, with who started it and how long it took", async ({
    page,
  }) => {
    await mockBackend(page, {
      taskHistory: finished,
      // Opened below; without a body the detail is a 404 the console logs.
      taskStates: {
        "robot01-task-1758000000-1": {
          id: "robot01-task-1758000000-1",
          status: "COMPLETED",
          steps: [{ id: "1-move", status: "COMPLETED", error_msg: "" }],
        },
      },
    });
    const listed = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/v1/task_history",
    );
    await page.goto("/history");
    const params = new URL((await listed).url()).searchParams;
    // Ten a page, asked for explicitly rather than left to the backend's 20.
    expect(params.get("page_size")).toBe("10");
    // The last day, open-ended: a job finishing while the page is open must
    // land inside the window.
    expect(params.get("since")).toBe("2026-09-17T10:00:00.000Z");
    expect(params.get("until")).toBeNull();

    // A job with no template name is called by its kind; a scheduled one by
    // the template it ran. Never by its id.
    await expect(
      page.getByRole("button", { name: /^COMPLETED Task Started directly/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^FAILED Morning round Scheduled · nightly/,
      }),
    ).toBeVisible();
    await expect(page.getByText("robot01-task-1758000000-1")).toBeHidden();
    // 09:40:00 → 09:44:12, measured between the backend's own timestamps.
    await expect(page.getByText("4:12", { exact: true })).toBeVisible();
    await expect(page.getByText("12:30", { exact: true })).toBeVisible();
    // Everything fits on one page, so there is nothing to page through.
    await expect(
      page.getByRole("navigation", { name: "History pages" }),
    ).toBeHidden();

    // The id is still there for whoever needs it: on expand.
    await page
      .getByRole("button", { name: /^COMPLETED Task Started directly/ })
      .click();
    await expect(
      page.getByText("robot01-task-1758000000-1", { exact: true }),
    ).toBeVisible();
  });

  test("counts the jobs the robot reports, per outcome and per kind", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");

    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(dashboard).toBeVisible();
    await expect(tile(dashboard, "Finished")).toHaveText("2");
    await expect(tile(dashboard, "Completed")).toHaveText("1");
    await expect(tile(dashboard, "Failed")).toHaveText("1");
    await expect(tile(dashboard, "Canceled")).toHaveText("0");
    await expect(tile(dashboard, "Success rate")).toHaveText("50 %");
    // The one bar lists every outcome on hover, zero included.
    await expect(
      dashboard.getByTitle("Completed 1 · Failed 1 · Canceled 0"),
    ).toBeAttached();
  });

  test("lists only failed jobs when that outcome is picked, without changing the counts", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    // The list re-reads with the outcome, and the window survives it.
    const filtered = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/v1/task_history" &&
        url.searchParams.get("status") === "FAILED" &&
        url.searchParams.get("since") !== null
      );
    });
    await page.getByRole("combobox", { name: "Outcome" }).click();
    await page.getByRole("option", { name: "Failed" }).click();
    await filtered;

    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(
      page.getByText(/Only failed jobs are listed below/),
    ).toBeVisible();
    // The dashboard is how the window's jobs ended, whichever are listed:
    // Finished still says 2 and the rate is still 50 %, not 0 %.
    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(tile(dashboard, "Finished")).toHaveText("2");
    await expect(tile(dashboard, "Success rate")).toHaveText("50 %");
    await expect(page).toHaveURL(/status=FAILED/);
  });

  test("asks for the last six hours when that preset is picked, and says so in the address", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) =>
        params.get("since") === "2026-09-18T04:00:00.000Z" &&
        params.get("until") === null,
    );
    await page.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "Last 6 h" }).click();
    await narrowed;

    await expect(page).toHaveURL(/\/history\?range=6h$/);
    // The scheduled job closed at 01:12, outside the six hours.
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeHidden();
    // Something is narrowed now, so there is something to reset.
    await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  });

  test("narrows both the counts and the list to one template's jobs", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) => params.get("name") === "Morning round",
    );
    await page.getByRole("combobox", { name: "Name" }).click();
    await page.getByRole("option", { name: "Morning round" }).click();
    await narrowed;

    await expect(page).toHaveURL(/name=Morning\+round/);
    await expect(page.getByText("Started directly")).toBeHidden();
    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(tile(dashboard, "Finished")).toHaveText("1");
  });

  test("narrows to scheduled jobs by kind, in the operator's words", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) => params.get("kind") === "schedule",
    );
    await page.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: "Scheduled" }).click();
    await narrowed;

    await expect(page).toHaveURL(/kind=schedule/);
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
  });

  test("reads a filter back from the address bar", async ({ page }) => {
    await mockBackend(page, { taskHistory: finished });
    // The outcome reaches the list only; the counts are read without it.
    const read = Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history" &&
          url.searchParams.get("status") === "FAILED" &&
          url.searchParams.get("kind") === "schedule" &&
          url.searchParams.get("since") === "2026-09-18T04:00:00.000Z"
        );
      }),
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history/stats" &&
          url.searchParams.get("status") === null &&
          url.searchParams.get("kind") === "schedule" &&
          url.searchParams.get("since") === "2026-09-18T04:00:00.000Z"
        );
      }),
    ]);
    await page.goto("/history?status=FAILED&range=6h&kind=schedule");
    await read;

    await expect(page.getByRole("combobox", { name: "Outcome" })).toContainText(
      "Failed",
    );
    await expect(page.getByRole("combobox", { name: "Time" })).toContainText(
      "Last 6 h",
    );
    await expect(page.getByRole("combobox", { name: "Kind" })).toContainText(
      "Scheduled",
    );
  });

  test("sends a custom range as UTC from the operator's own clock", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    await page.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "Custom range…" }).click();
    // Seeded from the window that was on screen, so the fields are never blank.
    await expect(page).toHaveURL(
      /range=custom&from=2026-09-17T10%3A00%3A00.000Z&to=2026-09-18T10%3A00%3A00.000Z/,
    );

    // The test browser's zone is UTC, so 09:00 typed is 09:00Z sent; the
    // conversion itself is covered in lib/task/history.test.ts for any zone.
    const bounded = historyReads(
      page,
      (params) =>
        params.get("since") === "2026-09-18T09:00:00.000Z" &&
        params.get("until") === "2026-09-18T10:00:00.000Z",
    );
    await page.getByLabel("From").fill("2026-09-18T09:00");
    await bounded;

    // The scheduled job closed at 01:12, before the range.
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeHidden();
  });

  test("says so when the window holds no finished job", async ({ page }) => {
    await mockBackend(page, { taskHistory: [] });
    await page.goto("/history");

    // Once under the counts, once where the list would be.
    await expect(
      page.getByText("No finished job in this window.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No finished job in this window. Jobs appear here once they end.",
      ),
    ).toBeVisible();
  });

  test("offers to clear the filters when they match nothing", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history?status=CANCELED");

    await expect(
      page.getByText("No finished job on this robot matches these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByText("Started directly")).toBeVisible();
  });

  test("pages forward with the cursor it was handed, and back without one", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished, taskHistoryPageSize: 1 });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Page 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

    const next = page.waitForRequest(
      (request) =>
        new URL(request.url()).searchParams.get("page_token") === "1",
    );
    await page.getByRole("button", { name: "Next" }).click();
    await next;

    // Replaced, not appended: this is page two, and it is the last one.
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(page.getByText("Page 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Page 1")).toBeVisible();
  });

  test("opens a job from anywhere on its row, with the reason a step failed", async ({
    page,
  }) => {
    await mockBackend(page, {
      taskHistory: finished,
      taskStates: {
        "nightly-2026-09-18T01:00:00Z": {
          id: "nightly-2026-09-18T01:00:00Z",
          status: "FAILED",
          steps: [
            { id: "1-move", status: "COMPLETED", error_msg: "" },
            { id: "2-move", status: "FAILED", error_msg: "Goal is blocked." },
          ],
        },
      },
    });
    await page.goto("/history");

    const described = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith(
        `/api/v1/tasks/${encodeURIComponent("nightly-2026-09-18T01:00:00Z")}`,
      ),
    );
    await page.getByText("Morning round").click();
    await described;

    await expect(
      page.getByRole("button", { name: /Morning round/ }),
    ).toHaveAttribute("aria-expanded", "true");
    // The id, once, in the detail.
    await expect(page.getByText("nightly-2026-09-18T01:00:00Z")).toBeVisible();
    await expect(page.getByText("2-move")).toBeVisible();
    await expect(page.getByText("Goal is blocked.")).toBeVisible();
  });
});

test.describe("the job history when the robot cannot answer", () => {
  // No console-error guard here: the browser logs the 502 itself, which is
  // exactly the response under test.
  test("shows the backend's own sentence and a way to try again", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.route("**/api/v1/task_history**", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "List task history failed" }),
      }),
    );
    await page.goto("/history");

    await expect(
      page.getByText("List task history failed").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry" }).first(),
    ).toBeVisible();
  });

  test("keeps the list when only the counts cannot be read", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
    await mockBackend(page, { taskHistory: [taskHistoryEntry()] });
    await page.route("**/api/v1/task_history/stats**", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Task history stats failed" }),
      }),
    );
    await page.goto("/history");

    await expect(page.getByText("Task history stats failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Started directly")).toBeVisible();
  });
});
