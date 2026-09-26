import { expect, test } from "@playwright/test";

import {
  MAP_NAME,
  failOnConsoleErrors,
  mapSummary,
  mockBackend,
  recording,
  taskHistoryEntry,
  taskTemplate,
  vertex,
} from "./backend";

/**
 * The flows where pressing a button does something to a real machine. Each one
 * asserts two halves that can drift apart: what the screen says, and what the
 * console actually sent. A test that only checks the screen passes a build that
 * posts to the wrong endpoint.
 */

test.describe("the recorder", () => {
  test("shows the idle form when nothing is recording", async ({ page }) => {
    // Which face is shown comes from the server, not from a local flag, so a
    // recording started from a shell is reflected correctly.
    await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await expect(page.getByRole("button", { name: /start recording/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  });

  test("shows the live face and the robot's own elapsed clock", async ({ page }) => {
    await mockBackend(page, {
      activeRecording: {
        name: "rec_live",
        path: "/home/syncai/record/rec_live",
        topics: ["/robot01/livox/lidar"],
        started_at: "2026-09-18T09:22:00Z",
        elapsed_seconds: 75,
        compression: false,
        size_bytes: 1024 * 1024,
      },
    });
    await page.goto("/recordings");

    // Exact, because "Recordings" (the rail link and the page heading) would
    // otherwise match too.
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    // 75 s as the robot measured it, not a timer this console started.
    await expect(page.getByText("1:15")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toHaveCount(0);
  });

  test("posts a start with the name and topics that were on screen", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("field-run-3");
    await page.getByRole("button", { name: /start recording/i }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/recordings"))
      .toHaveLength(1);
    const body = writes[0].body as { name: string; topics: string[] };
    expect(body.name).toBe("field-run-3");
    expect(body.topics.length).toBeGreaterThan(0);
  });

  test("refuses the reserved name before a request goes out", async ({ page }) => {
    // "active" is the status route's own path; a directory called that could
    // never be read back, and the backend refuses it too.
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("active");
    await expect(page.getByText(/reserved/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toBeDisabled();
    expect(writes).toHaveLength(0);
  });

  test("lists what is on disk", async ({ page }) => {
    await mockBackend(page, {
      recordings: [recording({ name: "rec_a" }), recording({ name: "rec_b" })],
    });
    await page.goto("/recordings");

    await expect(page.getByText("rec_a")).toBeVisible();
    await expect(page.getByText("rec_b")).toBeVisible();
  });
});

test.describe("the map library", () => {
  test("marks the map the stack is running and locks it", async ({ page }) => {
    // The running map is the one map that cannot be renamed or deleted — the
    // backend refuses both, and the card says so rather than letting the
    // operator find out from a 409.
    await mockBackend(page, { maps: [mapSummary({ active: true })] });
    await page.goto("/maps");

    await expect(page.getByRole("heading", { name: MAP_NAME })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Delete ${MAP_NAME}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Rename ${MAP_NAME}` }),
    ).toHaveCount(0);
  });

  test("puts a delete behind a dialog that names what goes with it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site", vertex_count: 3 }),
      ],
    });
    await page.goto("/maps");

    await page.getByRole("button", { name: "Delete old-site" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("old-site");
    // The waypoints are the part that surprises: hand-placed work that does not
    // live in the map directory being removed.
    await expect(dialog).toContainText("3 saved waypoints");

    // Backing out sends nothing.
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(0);
  });

  test("sends the delete only after the dialog is confirmed", async ({ page }) => {
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site" }),
      ],
    });
    await page.goto("/maps");

    await page.getByRole("button", { name: "Delete old-site" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/maps/old-site");
  });

  test("explains a conversion that failed instead of showing a hole", async ({
    page,
  }) => {
    await mockBackend(page, {
      maps: [
        mapSummary({
          active: false,
          name: "bad-cloud",
          grid: null,
          thumbnail: null,
          grid_status: "failed",
          grid_error: "intensity/normal gate selected no ground points",
        }),
      ],
    });
    await page.goto("/maps");

    await expect(
      page.getByText("intensity/normal gate selected no ground points"),
    ).toBeVisible();
  });
});

test.describe("the task console", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("lists the templates this robot can actually run", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/tasks");
    await expect(page.getByText("Morning round")).toBeVisible();
  });

  test("announces a run this tab did not start", async ({ page }) => {
    // The banner exists because a reload, a second browser or an overnight
    // schedule all leave a robot executing with no Cancel anywhere on screen.
    await mockBackend(page, {
      activeTasks: [
        {
          id: "robot01-task-1758000000-1",
          run_id: "run-1",
          status: "IN_PROGRESS",
          started_at: "2026-09-18T09:44:30Z",
          source: "SCHEDULE",
          schedule_id: "nightly",
        },
      ],
    });
    await page.goto("/tasks");

    await expect(page.getByText("Running outside this editor")).toBeVisible();
    await expect(page.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(page.getByText("via nightly")).toBeVisible();
  });

  test("cancels that run against the id it announced", async ({ page }) => {
    const writes = await mockBackend(page, {
      activeTasks: [
        {
          id: "robot01-task-1758000000-1",
          run_id: "run-1",
          status: "IN_PROGRESS",
          started_at: "2026-09-18T09:44:30Z",
          source: "DIRECT",
          schedule_id: null,
        },
      ],
    });
    await page.goto("/tasks");

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/tasks/robot01-task-1758000000-1");
  });

  test("registers a timed schedule as a cron the operator never typed", async ({
    page,
  }) => {
    // The backend's timed trigger is a cron expression, and this console is the
    // one that writes it. The operator picks a clock time and some weekdays;
    // the string those become is asserted here because it is the part a
    // screen-only test cannot see, and the part the scheduler acts on.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page.getByRole("button", { name: 'Schedule "Morning round"' }).click();
    await page.getByPlaceholder("robot01-daily-patrol").fill("weekday-patrol");
    await page.getByRole("button", { name: "Weekdays" }).click();
    await page.getByLabel("Time").fill("09:00");

    // The preview is the list's own sentence, shown before anything is sent,
    // and nothing on the pane may read as cron: no placeholder, no preview.
    await expect(
      page.getByText(
        /^Runs Weekdays at 09:00 in your local time \(.+\)\. Next run /,
      ),
    ).toBeVisible();
    await expect(page.getByText("* *")).toHaveCount(0);

    await page.getByRole("button", { name: "Create schedule" }).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);
    const write = writes.find((w) => w.method === "POST");
    expect(write?.path).toBe(
      "/api/v1/task_templates/22222222-2222-2222-2222-222222222222/schedule",
    );
    const body = write?.body as {
      id: string;
      trigger: { cron: string; timezone?: string; interval_seconds?: number };
    };
    expect(body.id).toBe("weekday-patrol");
    expect(body.trigger.cron).toBe("0 9 * * 1,2,3,4,5");
    // The browser's own zone travels with the cron; which one depends on the
    // machine running this, so only its presence is the console's promise.
    expect(body.trigger.timezone).toEqual(expect.stringMatching(/\S/));
    expect(body.trigger.interval_seconds).toBeUndefined();
  });

  test("posts an interval in seconds from the minutes the operator typed", async ({
    page,
  }) => {
    // The unit conversion is the one place a screen-only test would pass a
    // build that registers "every 30 seconds" for a robot meant to go every
    // 30 minutes.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page.getByRole("button", { name: 'Schedule "Morning round"' }).click();
    await page.getByPlaceholder("robot01-daily-patrol").fill("half-hourly");
    await page.getByRole("button", { name: "Interval" }).click();
    await page.getByLabel("Every").fill("30");
    await expect(page.getByText("Runs every 30 min.")).toBeVisible();

    await page.getByRole("button", { name: "Create schedule" }).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);
    const body = writes.find((w) => w.method === "POST")?.body as {
      trigger: { cron?: string; timezone?: string; interval_seconds?: number };
    };
    expect(body.trigger).toEqual({ interval_seconds: 1800 });
  });

  test.describe("from a browser in Taipei", () => {
    // Pinned so the local-time assertion below is one number, and so the row
    // has no reason to name a zone: the schedule's and the browser's agree.
    test.use({ timezoneId: "Asia/Taipei" });

    test("lists registered schedules above the editor, in words", async ({
      page,
    }) => {
      await mockBackend(page, {
        schedules: [
          {
            id: "nightly",
            trigger: { cron: "0 21 * * *", timezone: "Asia/Taipei" },
            paused: false,
            next_run_times: ["2026-09-24T13:00:00Z"],
          },
        ],
      });
      // Before the fixture's run, or the row would rightly call it past.
      await page.clock.setFixedTime(new Date("2026-09-24T12:00:00Z"));
      await page.goto("/tasks");

      // The stored cron is read back as a sentence, never shown as itself.
      await expect(page.getByText("Daily at 21:00 · Asia/Taipei")).toBeVisible();
      await expect(page.getByText("0 21 * * *")).toHaveCount(0);

      // 13:00Z is 21:00 on the operator's clock, and that is the number shown:
      // the UTC readout was the one that made a correct schedule look wrong.
      await expect(
        page.getByText("2026-09-24 21:00", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("UTC", { exact: true })).toHaveCount(0);

      // What the robot already does on its own sits with the library, above the
      // thing being drafted.
      const schedules = page.getByRole("heading", { name: "Registered schedules" });
      const editor = page.getByRole("button", { name: /Task editor/ });
      await expect(schedules).toBeVisible();
      const editorFollows = await schedules.evaluate(
        (heading, editorEl) =>
          Boolean(
            heading.compareDocumentPosition(editorEl as Node) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await editor.elementHandle(),
      );
      expect(editorFollows).toBe(true);
    });

    test("re-reads the list once the soonest run has passed, and only then", async ({
      page,
    }) => {
      // The list is not polled, so a schedule that fired while the page was
      // open used to keep showing the time it fired at until Refresh. The
      // soonest run time now sets one timer. This fake answers the first read
      // with a run a moment away and the second with the recomputed time
      // Temporal would give, so the row moving is proof the read happened.
      await mockBackend(page);
      let reads = 0;
      await page.route("**/api/v1/schedules", (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        reads += 1;
        const next =
          reads === 1
            ? new Date(Date.now() + 1500).toISOString()
            : "2027-01-01T01:00:00Z";
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "nightly",
              trigger: { cron: "0 21 * * *", timezone: "Asia/Taipei" },
              paused: false,
              next_run_times: [next],
            },
          ]),
        });
      });
      await page.goto("/tasks");

      await expect(
        page.getByText("2027-01-01 09:00", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      expect(reads).toBe(2);

      // A run months away sets no further read: the timer is the data's, not
      // a poll, and the second answer must not have started one.
      await page.waitForTimeout(2000);
      expect(reads).toBe(2);
    });
  });
});

test.describe("the step editor", () => {
  test("reorders by menu, drag and keyboard, and saves in the order shown", async ({
    page,
  }) => {
    // Three ways to move a row, one list. The saved body is the half a
    // screen-only test cannot see: the step ids are positional, so a reorder
    // that only moved the DOM would still post the old order.
    await mockBackend(page);
    // The create answers with its echo, which is schema-checked, so this route
    // replaces the generic "ok" — and, being the handler that fulfils it, is
    // where the posted body is read.
    const saved: unknown[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      saved.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({
            id: "33333333-3333-3333-3333-333333333333",
            name: "reorder-check",
          }),
        ),
      });
    });
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();

    // The add row's buttons share their labels with each row's type picker,
    // so they are reached by their hints.
    await page.getByTitle("Stand up. Nothing to set.").click();
    await page.getByTitle("Lie down. Nothing to set.").click();
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Hello");

    const rows = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^Reorder step/ }) });
    // Each row's type label, top to bottom.
    const order = () =>
      rows.evaluateAll((items) =>
        items.map((item) => item.querySelector(".instrument-label")?.textContent),
      );
    await expect.poll(order).toEqual(["Stand", "Lie", "Speak"]);

    // Menu: the last row straight to the top.
    await page.getByRole("button", { name: "More actions for step 3" }).click();
    await page.getByRole("menuitem", { name: "Move to top" }).click();
    await expect.poll(order).toEqual(["Speak", "Stand", "Lie"]);

    // Drag: the last row's handle onto the first row.
    const handle = page.getByRole("button", { name: "Reorder step 3" });
    const from = (await handle.boundingBox())!;
    const to = (await rows.first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(["Lie", "Speak", "Stand"]);

    // Keyboard: pick the last row up, one slot up, drop.
    // Each key waits for the one before it to land: the sensor measures the
    // rows after pick-up, and a move sent before that is dropped.
    const grip = page.getByRole("button", { name: "Reorder step 3" });
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByText("is over position 2 of 3")).toBeAttached();
    await page.keyboard.press("Space");
    await expect.poll(order).toEqual(["Lie", "Stand", "Speak"]);

    await page.getByPlaceholder("Morning patrol").fill("reorder-check");
    await page.getByRole("button", { name: "Save as new" }).click();

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as { steps: { id: string }[] };
    expect(body.steps.map((step) => step.id)).toEqual([
      "1-liedown",
      "2-standup",
      "3-speak",
    ]);
  });

  test("loads a template folded and folds an unfinished row to its problem", async ({
    page,
  }) => {
    // Folded rows are what keep a twenty-step patrol on one screen. The two
    // rules worth pinning: a loaded template arrives as one-line summaries,
    // and every row folds — an unfinished one included — with the problem
    // standing in for its summary, so it is still findable when the operator
    // goes looking for why Save is greyed out.
    await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    // The MOVE row's only input is its waypoint picker.
    const waypoint = page.getByRole("listitem").getByRole("combobox");
    await expect(page.getByText(/^dock · \(/)).toBeVisible();
    await expect(waypoint).toHaveCount(0);

    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    const say = page.getByPlaceholder(/Delivery arrived/);
    await expect(say).toBeVisible();

    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(waypoint).toBeVisible();
    // Unfolded, a MOVE row is the picker alone: no coordinate fields.
    await expect(page.getByLabel(/^(X|Y|Heading)\b/)).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(waypoint).toHaveCount(0);
    // Empty, and folded all the same: the header says what is missing.
    await expect(say).toHaveCount(0);
    const speakRow = page.getByRole("button", { name: /^Speak/, expanded: false });
    await expect(speakRow).toHaveText(/Needs something to say\./);

    // Unfold, fill, fold: the line is read back in place of the problem.
    await speakRow.click();
    await say.fill("Hello");
    await page.getByRole("button", { name: /^Speak/, expanded: true }).click();
    await expect(say).toHaveCount(0);
    await expect(page.getByText("“Hello”")).toBeVisible();
  });

  test("picks a waypoint by clicking it on the floor plan", async ({ page }) => {
    // A name in the picker is not a place. The floor plan beside it is drawn
    // in the same frame the map editor uses, so a click on a marker has to
    // land on the stop the editor placed there — and what the console then
    // saves has to be that stop's pose, not the one under the pointer.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "GENERAL",
      x: -3,
      y: 4,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room] });
    const saved: unknown[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      saved.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "33333333-3333-3333-3333-333333333333", name: "to room" }),
        ),
      });
    });
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();
    await page.getByTitle("Drive to a pose in the map frame.").click();

    // Closed until asked for: a map under every row would bury the list.
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f with 2 waypoints/ });
    await expect(plan).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Floor plan" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(plan).toBeVisible();
    await expect(plan).toHaveAccessibleName(/waypoints\.$/);

    // Where the marker is, from the mock's own geometry: the same fit-and-
    // centre the preview draws with (lib/map/preview.ts previewView, which is
    // fitView inside PREVIEW_INSET, then worldToGrid).
    const grid = mapSummary().grid;
    const box = (await plan.boundingBox())!;
    const inset = { top: 20, right: 48, bottom: 20, left: 20 };
    const innerW = box.width - inset.left - inset.right;
    const innerH = box.height - inset.top - inset.bottom;
    const scale = Math.min(innerW / grid.width, innerH / grid.height);
    const ox = inset.left + (innerW - grid.width * scale) / 2;
    const oy = inset.top + (innerH - grid.height * scale) / 2;
    const px = (room.x - grid.origin.x) / grid.resolution;
    const py = grid.height - (room.y - grid.origin.y) / grid.resolution;
    await page.mouse.click(box.x + ox + px * scale, box.y + oy + py * scale);

    // Both faces of the row agree on the pick, and the map says so too.
    await expect(page.getByRole("listitem").getByRole("combobox")).toContainText("room-a");
    await expect(plan).toHaveAccessibleName(/room-a is picked\.$/);
    await page.getByRole("button", { name: /^Move/, expanded: true }).click();
    await expect(page.getByText(/^room-a · \(/)).toBeVisible();

    await page.getByPlaceholder("Morning patrol").fill("to room");
    await page.getByRole("button", { name: "Save as new" }).click();

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as {
      steps: { id: string; vertex_id: string; params: { x: number; y: number } }[];
    };
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].id).toBe("1-move");
    expect(body.steps[0].vertex_id).toBe(room.id);
    expect(body.steps[0].params).toMatchObject({ x: -3, y: 4 });
  });
});

test.describe("the job history", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
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
    }),
  ];

  test("lists each job by id, with who started it and how long it took", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    const listed = page.waitForRequest((request) =>
      request.url().includes("/api/v1/task_history"),
    );
    await page.goto("/history");
    // Ten a page, asked for explicitly rather than left to the backend's 20.
    expect(new URL((await listed).url()).searchParams.get("page_size")).toBe("10");

    await expect(page.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    // 09:40:00 → 09:44:12, measured between the backend's own timestamps.
    await expect(page.getByText("4:12", { exact: true })).toBeVisible();
    await expect(page.getByText("12:30", { exact: true })).toBeVisible();
    // Everything fits on one page, so there is nothing to page through.
    await expect(page.getByRole("navigation", { name: "History pages" })).toBeHidden();
  });

  test("asks the robot for failed jobs only when that filter is picked", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const filtered = page.waitForRequest(
      (request) =>
        request.url().includes("/api/v1/task_history") &&
        new URL(request.url()).searchParams.get("status") === "FAILED",
    );
    await page.getByRole("button", { name: "Failed", exact: true }).click();
    await filtered;

    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
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
    await page.getByText("nightly-2026-09-18T01:00:00Z").click();
    await described;

    await expect(
      page.getByRole("button", { name: /nightly-2026-09-18T01:00:00Z/ }),
    ).toHaveAttribute("aria-expanded", "true");
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

    await expect(page.getByText("List task history failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
