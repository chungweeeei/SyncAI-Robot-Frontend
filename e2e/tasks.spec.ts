import { expect, test, type Page } from "@playwright/test";

import { vertexScreen } from "@/lib/map/draw";
import { previewView } from "@/lib/map/preview";
import type { MapMetadata } from "@/lib/types/robot";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  floorPlanPng,
  mapSummary,
  mockBackend,
  octomapBt,
  taskState,
  taskSteps,
  taskTemplate,
  vertex,
  withOctomap,
} from "./backend";

/** mapSummary()'s grid, in the shape the preview's view transform takes. */
const PREVIEW_META: MapMetadata = {
  resolution: 0.05,
  origin: [-12.3, -7.8, 0],
  width: 400,
  height: 300,
};

/**
 * Add an action where it says: "before setting off", "on arrival at stop 1" or
 * "on the way to stop 1". A stop card has one Add, its menu in two groups
 * headed "At <waypoint>" and "On the way to <waypoint>".
 */
async function addAction(page: Page, type: string, where = "before setting off") {
  const item = new RegExp(`^${type}`);
  const atStop = /^(on arrival at|on the way to) (stop \d+)$/.exec(where);
  if (!atStop) {
    await page.getByRole("button", { name: `Add an action ${where}` }).click();
    await page.getByRole("menuitem", { name: item }).click();
    return;
  }
  await page.getByRole("button", { name: `Add an action at ${atStop[2]}` }).click();
  const group = page.getByRole("group", {
    name: atStop[1] === "on arrival at" ? /^At / : /^On the way to /,
  });
  await group.getByRole("menuitem", { name: item }).click();
}

/** Pick a stop's waypoint by name, from the search list on its card. */
async function pickWaypoint(page: Page, stop: number, name: string) {
  await page.getByRole("combobox", { name: `Waypoint for stop ${stop}` }).click();
  await page.getByRole("option", { name: new RegExp(`^${name}\\b`) }).click();
}

/**
 * The task console and the step editor, and the jobs they dispatch.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
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

  test("opens an empty editor from Create task, and back", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Create task" }).click();

    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();

    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    // Opening an editor is not a write.
    expect(writes).toEqual([]);
  });

  test("asks before Create task clears unsaved steps", async ({ page }) => {
    // The draft outlives the editor's page, so from the overview it is out of
    // sight. Declining keeps it; accepting is the only way it goes.
    const writes = await mockBackend(page);
    await page.goto("/tasks/editor");
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await page.goto("/tasks");

    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    expect(asked).toMatch(/unsaved changes/);
    await expect(page.getByPlaceholder(/Delivery arrived/)).toHaveValue("Arrived");

    await page.goto("/tasks");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await expect(page.getByPlaceholder(/Delivery arrived/)).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test("does not ask about a saved job opened and left as it was", async ({ page }) => {
    // A loaded job is only unsaved once it differs from its row: a needless
    // prompt teaches the operator to press OK through the one that matters.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    expect(asked).toEqual([]);
  });

  test("asks before the tab closes on unsaved work, and only then", async ({ page }) => {
    // The draft survives a trip to another screen but not the tab. Positive
    // control first: an untouched saved job closes without a question.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();

    const kinds: string[] = [];
    page.on("dialog", (dialog) => {
      kinds.push(dialog.type());
      void dialog.dismiss();
    });
    // Chromium only honours beforeunload on a page the user has touched.
    await page.getByLabel("Job summary").click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    expect(kinds).toEqual([]);
    // Waited for through the stop, so the library has answered by the time
    // the chip's absence is read.
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 1" })).toHaveText("dock");
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    await addAction(page, "Speak", "on arrival at stop 1");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => kinds).toEqual(["beforeunload"]);
  });

  test("counts a job's paused schedules, and points at them in the list", async ({
    page,
  }) => {
    // Three schedules, two paused: the chip must show the pauses, not leave
    // them to a hover title a finger never sees.
    const template = "22222222-2222-2222-2222-222222222222";
    const linked = (id: string, paused: boolean) => ({
      id,
      trigger: { interval_seconds: 1800 },
      paused,
      next_run_times: paused ? [] : ["2027-01-01T01:00:00Z"],
      task_template_id: template,
      task_template_name: "Morning round",
    });
    const writes = await mockBackend(page, {
      schedules: [
        linked("half-hourly", false),
        {
          id: "other",
          trigger: { interval_seconds: 3600 },
          paused: false,
          next_run_times: [],
        },
        linked("weekend", true),
        linked("holiday", true),
      ],
    });
    await page.goto("/tasks");

    const chip = page.getByRole("button", {
      name: /^Show the schedules for "Morning round"/,
    });
    await expect(chip).toHaveText("3 schedules · 2 paused");
    await chip.click();

    // Lands on the job's first schedule, not on the list's first row.
    const first = page.locator(`li[data-template-id="${template}"]`).first();
    await expect(first).toBeFocused();
    await expect(first).toContainText("half-hourly");
    // Exactly that job's three, and not the unrelated one.
    const lit = page.locator("li[data-highlighted]");
    await expect(lit).toHaveCount(3);
    await expect(lit.filter({ hasText: "other" })).toHaveCount(0);
    // A flash, not a selection.
    await expect(lit).toHaveCount(0, { timeout: 5000 });
    expect(writes).toEqual([]);
  });

  test("lists another map's jobs, marked and not runnable", async ({
    page,
  }) => {
    // A job for a map the robot is not on is still the operator's work: it is
    // listed and can be opened, but its coordinates are in another frame, so
    // the two buttons that would move the robot are held.
    await mockBackend(page, {
      templates: [
        taskTemplate(),
        taskTemplate({
          id: "55555555-5555-5555-5555-555555555555",
          name: "Second floor",
          map_name: "wh1",
          map_matches_active: false,
        }),
      ],
    });
    await page.goto("/tasks");

    await expect(page.getByText("Second floor")).toBeVisible();
    await expect(
      page.getByText("Saved for wh1; the robot has dp2f loaded."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: 'Dispatch "Second floor" now' }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: 'Schedule "Second floor"' }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: 'Load "Second floor" into the editor' }),
    ).toBeEnabled();
    // The loaded map's job is untouched by the other one's presence.
    await expect(
      page.getByRole("button", { name: 'Dispatch "Morning round" now' }),
    ).toBeEnabled();
  });

  test("keeps an unsaved job while waypoints are placed on the map", async ({
    page,
  }) => {
    // Adding a missing waypoint mid-job must not throw the job away: the link
    // opens that map's editor in Waypoints mode, back returns here, and the
    // draft is as it was, across a reload too.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await addAction(page, "Speak", "on arrival at stop 1");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");

    await page
      .getByRole("link", { name: "Add waypoints on the floor plan" })
      .click();
    await expect(page).toHaveURL(/\/maps\/dp2f\/edit\?mode=vertex&from=tasks$/);
    // Opened with Waypoint chosen to draw, not with nothing chosen as the
    // editor otherwise opens.
    await expect(page.getByRole("combobox", { name: "Draw" })).toContainText(
      "Waypoint",
    );

    await page.getByRole("button", { name: "Back to tasks" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const stop = page.getByRole("combobox", { name: "Waypoint for stop 1" });
    const asLeft = async () => {
      await expect(
        page.getByRole("heading", { name: "Morning round" }),
      ).toBeVisible();
      await expect(stop).toHaveText("dock");
      await expect(page.getByPlaceholder(/Delivery arrived/)).toHaveValue("Arrived");
    };
    await asLeft();

    // A reload is the other way to lose the draft; the tab keeps it.
    await page.reload();
    await asLeft();

    // Go back leaves it too: the overview, and the same job on return.
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await page.goto("/tasks/editor");
    await asLeft();

    // Only Create task, once confirmed, empties it — across a reload too.
    await page.goto("/tasks");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Morning round" }),
    ).toHaveCount(0);
    await expect(stop).toHaveCount(0);
  });

  test("saves over the loaded job, and stays on a new one as loaded", async ({
    page,
  }) => {
    // One Save: a loaded template is updated in place, never copied. A job
    // saved for the first time stays open as the loaded template, so the next
    // Save updates it rather than making a second one.
    const loaded = "22222222-2222-2222-2222-222222222222";
    const created = "44444444-4444-4444-4444-444444444444";
    await mockBackend(page);
    const writes: { method: string; path: string }[] = [];
    await page.route("**/api/v1/task_templates**", (route) => {
      const request = route.request();
      const method = request.method();
      if (method === "GET") return route.fallback();
      const path = new URL(request.url()).pathname;
      writes.push({ method, path });
      const body = request.postDataJSON() as { name: string };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({
            id: method === "POST" || path.endsWith(created) ? created : loaded,
            name: body.name,
          }),
        ),
      });
    });

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => writes)
      .toEqual([{ method: "PUT", path: `/api/v1/task_templates/${loaded}` }]);
    // The page does not move on a save, so a card says it landed.
    const notice = page.getByRole("status").filter({ hasText: "Saved Morning round" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toBeHidden();

    // A fresh job. The loaded one is still in the draft, so Create task asks first.
    await page.goto("/tasks");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    const save = page.getByRole("button", { name: "Save", exact: true });
    // No name yet: Save sends nothing and points at the name field, and
    // Enter there is the same Save.
    const field = page.getByRole("textbox", { name: "Task name" });
    await save.click();
    await expect(field).toBeFocused();
    await expect(page.getByText("Name this task to save it.")).toBeVisible();
    expect(writes).toHaveLength(1);
    await field.fill("greeting");
    await expect(page.getByText("Name this task to save it.")).toHaveCount(0);
    // Schedules stay on /tasks.
    await expect(
      page.getByRole("radiogroup", { name: "When to run" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create schedule" }),
    ).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => writes.slice(1))
      .toEqual([{ method: "POST", path: "/api/v1/task_templates" }]);
    await expect(page.getByRole("status").filter({ hasText: "Saved greeting" })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await expect(page.getByRole("heading", { name: "greeting" })).toBeAttached();

    // The second press updates what the first made.
    await save.click();
    await expect
      .poll(() => writes.slice(2))
      .toEqual([{ method: "PUT", path: `/api/v1/task_templates/${created}` }]);
  });

  test("names a new job in the heading and saves it in one press", async ({
    page,
  }) => {
    // The name is typed straight into the heading, and Save sends it with
    // the steps.
    await mockBackend(page);
    const posted: { name: string; steps: unknown[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: unknown[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "44444444-4444-4444-4444-444444444444", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.name).toBe("greeting");
    expect(posted[0]!.steps).toHaveLength(1);
    await expect(page.getByRole("status").filter({ hasText: "Saved greeting" })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
  });

  test("saves a Speak said more than once with its count", async ({ page }) => {
    // Both halves: the count on screen, and the count in the body. A line
    // said once sends none, so a save from before the field is unchanged.
    await mockBackend(page);
    const posted: { steps: { params?: Record<string, unknown> }[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: [] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "66666666-6666-6666-6666-666666666666", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    const times = page.getByRole("textbox", { name: "Times, before setting off" });
    await expect(times).toHaveValue("1");

    // Past the limit the row says so, and Save points at it and sends nothing.
    await times.fill("51");
    await expect(page.getByText("Say it 1 to 50 times.")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.locator("header").getByText(/^Some stops or actions are incomplete/),
    ).toBeVisible();
    expect(posted).toEqual([]);

    await times.fill("3");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps[0]!.params).toEqual({ text: "Arriving", repeat: 3 });
  });

  test("saves steps boxed together as one group", async ({ page }) => {
    // The robot starts a group's steps together; the seam between two rows is
    // how an operator says so, and the wire has to carry it as a shared name.
    await mockBackend(page);
    const posted: { steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: Record<string, unknown>[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "55555555-5555-5555-5555-555555555555", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    await addAction(page, "Stand");
    await addAction(page, "Wait");
    await page.getByRole("textbox", { name: "Duration, before setting off" }).fill("5");

    // A seam in each gap and none above the first row, which has nothing to
    // run with.
    await expect(page.getByRole("button", { name: /^(Start together|Split here):/ })).toHaveCount(2);
    const seam = page.getByRole("button", { name: "Start together: action 1 and action 2" });
    await expect(page.getByRole("button", { name: /^Ungroup/ })).toHaveCount(0);
    await seam.click();
    // The pair is one box now, and the seam between them offers to split it.
    await expect(page.getByRole("button", { name: "Ungroup actions 1 to 2" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Split here: run action 2 after action 1" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps.map((step) => [step.id, step.group])).toEqual([
      ["1-speak", "g1"],
      ["2-standup", "g1"],
      ["3-wait", undefined],
    ]);
  });

  test("refuses to start two body steps together, and says why", async ({ page }) => {
    // The robot has one body, so the editor never builds the group the
    // backend would refuse: the seam stays, says why, and does nothing.
    const writes = await mockBackend(page);
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("bow");
    await addAction(page, "Stand");
    await addAction(page, "Lie down");
    const save = page.getByRole("button", { name: "Save", exact: true });

    const seam = page.getByRole("button", { name: /^Can't start together: action 1 and action 2/ });
    await expect(seam).toHaveAttribute("aria-disabled", "true");
    // Forced: the seam is aria-disabled, and what it does when pressed anyway
    // is what is under test.
    await seam.click({ force: true });
    await expect(page.getByRole("button", { name: /^Ungroup/ })).toHaveCount(0);
    await expect(save).toBeEnabled();

    // The row's menu, a finger's way to the same link, refuses it too.
    await page.getByRole("button", { name: "More actions for Lie down before setting off" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Start together with the action above" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/one Move, Dock, Stand or Lie down at a time/)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("marks the row a refused save names, in the backend's words", async ({ page }) => {
    // For a rule the editor does not mirror: the backend names the step,
    // and the row it was sent from carries the sentence.
    await mockBackend(page);
    const refusal = "Step '2-speak' cannot run here.";
    const posted: { steps: { id: string }[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(route.request().postDataJSON() as { steps: { id: string }[] });
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: refusal, code: "invalid_step_group", step_id: "2-speak" }),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await addAction(page, "Wait");
    await page.getByRole("textbox", { name: "Duration, before setting off" }).fill("5");
    await addAction(page, "Speak");
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => posted.map((body) => body.steps.map((step) => step.id))).toEqual([
      ["1-wait", "2-speak"],
    ]);
    const rows = page.getByRole("region", { name: "Stops" }).getByRole("listitem");
    await expect(rows.nth(1)).toContainText(refusal);
    await expect(rows.nth(0)).not.toContainText(refusal);
    // Still in the heading too: the row says where, the heading says it happened.
    await expect(page.locator("header").getByRole("alert").filter({ hasText: refusal })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    // The 400 is the behaviour under test; Chromium logs every refusal it fetches.
    errors = errors.filter((text) => !/status of 400/.test(text));
  });

  test("loads a saved group back as a box, and Ungroup takes it apart", async ({ page }) => {
    const speakStep = (id: string, text: string) => ({
      id,
      vertex_id: null,
      vertex_name: null,
      vertex_status: "NONE",
      group: "g1",
      type: "SPEAK",
      params: { text },
      resolved_params: { text },
    });
    await mockBackend(page, {
      templates: [
        taskTemplate({
          map_name: null,
          steps: [speakStep("1-speak", "Hello"), speakStep("2-speak", "World")],
        }),
      ],
    });
    await page.goto("/tasks");
    // The library row shows the pair as one bracket.
    await expect(page.getByText("[T T]")).toBeVisible();
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    const ungroup = page.getByRole("button", { name: "Ungroup actions 1 to 2" });
    await expect(ungroup).toBeVisible();
    // Opened and left as it was: nothing to save.
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    // The header goes with the box, so focus lands on the seam that would put
    // it back rather than falling to the page.
    await ungroup.click();
    await expect(ungroup).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start together: action 1 and action 2" }),
    ).toBeFocused();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("renames a saved job through Save, and Escape backs out", async ({
    page,
  }) => {
    // A rename is a Save like any other edit: the name goes with the steps,
    // so a step edit made beside it is saved with it rather than left behind.
    const template = "22222222-2222-2222-2222-222222222222";
    await mockBackend(page);
    const puts: { name: string; steps: unknown[] }[] = [];
    await page.route(`**/api/v1/task_templates/${template}`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: unknown[] };
      puts.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ name: body.name })),
      });
    });
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await addAction(page, "Speak", "on arrival at stop 1");
    await page.getByPlaceholder(/Delivery arrived/).fill("Evening");

    const field = page.getByRole("textbox", { name: "Task name" });
    await expect(field).toHaveValue("Morning round");
    await field.fill("Evening round");
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("Morning round");
    expect(puts).toEqual([]);

    await field.fill("Evening round");
    await page.keyboard.press("Enter");
    await expect.poll(() => puts).toHaveLength(1);
    expect(puts[0]!.name).toBe("Evening round");
    // The step added beside the rename went with it.
    expect(puts[0]!.steps).toContainEqual(
      expect.objectContaining({ type: "SPEAK", params: { text: "Evening" } }),
    );
    await expect(
      page.getByRole("heading", { name: "Evening round" }),
    ).toBeAttached();
  });

  test("deletes the loaded job only once confirmed, and leaves", async ({
    page,
  }) => {
    // Delete is in the job's menu, away from Save, and a kept dialog sends
    // nothing; the dialog names the schedules that will outlive the job,
    // since each keeps its own copy of the steps.
    const template = "22222222-2222-2222-2222-222222222222";
    const writes = await mockBackend(page, {
      schedules: [
        {
          id: "half-hourly",
          trigger: { interval_seconds: 1800 },
          paused: false,
          next_run_times: [],
          task_template_id: template,
        },
      ],
    });
    await page.goto("/tasks/editor");
    // A new job has nothing to delete.
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    const more = page.getByRole("button", { name: "More for this job" });
    await expect(more).toHaveCount(0);

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const remove = async () => {
      await more.click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
    };

    await remove();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Delete Morning round?");
    await expect(dialog).toContainText("Its schedule keeps running");
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

    await remove();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    expect(
      writes.filter((w) => w.method === "DELETE").map((w) => w.path),
    ).toEqual([`/api/v1/task_templates/${template}`]);
    // The draft went with it: the editor opens empty.
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
  });

  test("authors a job for a map the robot is not on", async ({ page }) => {
    // A job built for another map: the picker lists only that map's
    // waypoints, the saved body names that map, and Save & run stays held
    // because the robot is not there.
    const bay = vertex({
      id: "66666666-6666-6666-6666-666666666666",
      name: "bay-1",
      type: "MOVE",
      map_name: "wh1",
      x: 1,
      y: 2,
      theta: 0,
    });
    await mockBackend(page, {
      maps: [
        mapSummary(),
        mapSummary({ name: "wh1", active: false, vertex_count: 1 }),
      ],
      vertices: [vertex(), bay],
    });
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
            name: "to bay",
            map_name: "wh1",
            map_matches_active: false,
          }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await page.getByRole("button", { name: "Add a Move stop" }).click();

    // Opens on the loaded map, and says so.
    const map = page.getByRole("combobox", { name: "Map" });
    await expect(map).toContainText("dp2f · loaded");
    await map.click();
    await page.getByRole("option", { name: "wh1" }).click();
    await expect(map).toContainText("wh1");

    const waypoint = page.getByRole("combobox", { name: "Waypoint for stop 1" });
    await waypoint.click();
    await expect(page.getByRole("option", { name: "bay-1" })).toBeVisible();
    await expect(page.getByRole("option", { name: "dock" })).toHaveCount(0);
    await page.getByRole("option", { name: "bay-1" }).click();
    await expect(waypoint).toContainText("bay-1");

    // Held, with the reason, until that map is the loaded one.
    await expect(
      page
        .getByText("This job is for wh1; the robot has dp2f loaded", {
          exact: false,
        })
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and run" })).toBeDisabled();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Task name" }).fill("to bay");
    await page.keyboard.press("Enter");

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as {
      map_name: string;
      steps: { vertex_id: string }[];
    };
    expect(body.map_name).toBe("wh1");
    expect(body.steps[0].vertex_id).toBe(bay.id);
  });

  test("saves and runs the job from the editor, and keeps the steps still while it runs", async ({
    page,
  }) => {
    // Tuning a job on site is edit, run, watch, edit: Save & run writes the
    // job, then sends the saved row, named, on its map.
    const template = "22222222-2222-2222-2222-222222222222";
    const writes = await mockBackend(page);
    await page.route(`**/api/v1/task_templates/${template}`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON() as { name: string };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ name: body.name })),
      });
    });
    // The run it starts, as the robot reports it: its one stop under way.
    await page.route("**/api/v1/tasks/*", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskState({ id, steps: [{ id: "1-move", status: "IN_PROGRESS", error_msg: "" }] }),
        ),
      });
    });
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await page.getByRole("button", { name: "Save and run" }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const body = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      name: string | null;
      map_name?: string;
      steps: { id: string }[];
    };
    expect(body.name).toBe("Morning round");
    expect(body.map_name).toBe(MAP_NAME);
    expect(body.steps.map((step) => step.id)).toEqual(["1-move"]);
    // The stop says how it is going, and since the step ids are positional
    // the list holds still while they are followed.
    await expect(page.locator('[data-stop="1"]')).toContainText("IN PROGRESS");
    await expect(
      page.getByRole("button", { name: "Add an action at stop 1" }),
    ).toBeDisabled();
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

    // Scoped past the masthead: its bar names the running job's id too, so a
    // page-wide locator would match both and prove neither.
    const banner = page.locator("main");
    await expect(banner.getByText("Running outside this page")).toBeVisible();
    await expect(banner.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(banner.getByText("via nightly")).toBeVisible();
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

    // The banner's own button: the masthead carries a second Cancel for the
    // same run (see run-controls.spec.ts), and this test is about the banner.
    await page
      .getByRole("main")
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/tasks/robot01-task-1758000000-1");
  });

  test("registers a timed schedule as a cron the operator never typed", async ({
    page,
  }) => {
    // The console writes the trigger's cron from a clock time and weekdays;
    // the string is what the scheduler acts on and a screen cannot show.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Schedule "Morning round"' })
      .click();
    // The form opens here, over the list it will join, not in the editor.
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByText("Schedule Morning round")).toBeVisible();
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
    // A screen-only test would pass a build that registers "every 30 seconds"
    // for "every 30 minutes".
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Schedule "Morning round"' })
      .click();
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

    test("edits a schedule's time in place, and keeps its name", async ({
      page,
    }) => {
      // The edit is a PATCH of the trigger alone: a delete and re-create
      // would lose the name and a pause, and still pass on screen.
      const writes = await mockBackend(page, {
        schedules: [
          {
            id: "nightly",
            trigger: { cron: "0 21 * * *", timezone: "Asia/Taipei" },
            paused: true,
            next_run_times: [],
          },
        ],
      });
      await page.goto("/tasks");

      await page.getByRole("button", { name: "Edit schedule" }).click();
      await expect(page.getByText("Edit nightly")).toBeVisible();
      // Opens on the registered rule, with nothing to send until it changes;
      // a schedule has no rename, so the name is not asked for.
      await expect(page.getByRole("button", { name: "Daily" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByLabel("Time")).toHaveValue("21:00");
      await expect(page.getByPlaceholder("robot01-daily-patrol")).toHaveCount(
        0,
      );
      const save = page.getByRole("button", { name: "Save schedule" });
      await expect(save).toBeDisabled();

      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByLabel("Time").fill("10:30");
      await save.click();

      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({
        method: "PATCH",
        path: "/api/v1/schedules/nightly",
        body: {
          trigger: { cron: "30 10 * * 1,2,3,4,5", timezone: "Asia/Taipei" },
        },
      });
      await expect(page.getByText("Edit nightly")).toHaveCount(0);
      await expect(
        page.getByText("Weekdays at 10:30 · Asia/Taipei"),
      ).toBeVisible();
      // Still the same schedule, still paused.
      await expect(page.getByText("nightly", { exact: true })).toBeVisible();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    });

    /**
     * The robot's schedule list trails a write by a second or two, so the
     * first two reads after it answer the old list; the new row must still
     * appear without a Refresh.
     */
    test("shows a new schedule without a Refresh while the list catches up", async ({
      page,
    }) => {
      const template = "22222222-2222-2222-2222-222222222222";
      const created = {
        id: "weekday-patrol",
        trigger: { cron: "0 9 * * 1,2,3,4,5", timezone: "Asia/Taipei" },
        paused: false,
        next_run_times: ["2099-01-01T01:00:00Z"],
        task_template_id: template,
        task_template_name: "Morning round",
      };
      let registered = false;
      let staleReads = 0;
      await mockBackend(page);
      await page.route("**/api/v1/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.endsWith("/schedule"))
          registered = true;
        if (request.method() !== "GET" || path !== "/api/v1/schedules") {
          return route.fallback();
        }
        if (registered && staleReads < 2) {
          staleReads++;
          return route.fulfill({ json: [] });
        }
        return route.fulfill({ json: registered ? [created] : [] });
      });
      await page.goto("/tasks");
      await expect(
        page.getByText("No schedules are registered on this robot."),
      ).toBeVisible();

      await page
        .getByRole("button", { name: 'Schedule "Morning round"' })
        .click();
      await page
        .getByPlaceholder("robot01-daily-patrol")
        .fill("weekday-patrol");
      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByRole("button", { name: "Create schedule" }).click();

      const row = page
        .getByRole("listitem")
        .filter({ hasText: "weekday-patrol" });
      await expect(
        row.getByText("Weekdays at 09:00 · Asia/Taipei"),
      ).toBeVisible();
      await expect(
        row.getByText("2099-01-01 09:00", { exact: true }),
      ).toBeVisible();
      expect(staleReads).toBe(2);
      // The job's own chip reads the same list, so it catches up with it.
      await expect(
        page.getByRole("button", {
          name: /^Show the schedules for "Morning round"/,
        }),
      ).toHaveText("Weekdays at 09:00 · Asia/Taipei");
    });

    test("keeps an edited row on its new time while the list catches up", async ({
      page,
    }) => {
      const before = {
        id: "nightly",
        trigger: { cron: "0 21 * * *", timezone: "Asia/Taipei" },
        paused: false,
        next_run_times: ["2098-12-31T13:00:00Z"],
      };
      const after = {
        ...before,
        trigger: { cron: "30 10 * * *", timezone: "Asia/Taipei" },
        next_run_times: ["2099-01-01T02:30:00Z"],
      };
      let patched = false;
      let staleReads = 0;
      // A copy: the fake applies the PATCH to the row it holds, and the stale
      // reads below must still answer the rule as it was.
      await mockBackend(page, { schedules: [{ ...before }] });
      await page.route("**/api/v1/**", (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() === "PATCH") patched = true;
        if (request.method() !== "GET" || path !== "/api/v1/schedules") {
          return route.fallback();
        }
        if (patched && staleReads < 2) {
          staleReads++;
          return route.fulfill({ json: [before] });
        }
        return route.fulfill({ json: [patched ? after : before] });
      });
      await page.goto("/tasks");

      await page.getByRole("button", { name: "Edit schedule" }).click();
      await page.getByLabel("Time").fill("10:30");
      await page.getByRole("button", { name: "Save schedule" }).click();

      // The new rule at once, and the next run it implies once the list has it.
      await expect(
        page.getByText("Daily at 10:30 · Asia/Taipei"),
      ).toBeVisible();
      await expect(
        page.getByText("2099-01-01 10:30", { exact: true }),
      ).toBeVisible();
      expect(staleReads).toBe(2);
      // The stale reads never reached the row.
      await expect(page.getByText("Daily at 21:00 · Asia/Taipei")).toHaveCount(
        0,
      );
    });

    test("lists registered schedules in words", async ({ page }) => {
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
      await expect(
        page.getByText("Daily at 21:00 · Asia/Taipei"),
      ).toBeVisible();
      await expect(page.getByText("0 21 * * *")).toHaveCount(0);

      // 13:00Z is 21:00 on the operator's clock, and that is the number shown;
      // UTC would make a correct schedule look wrong.
      await expect(
        page.getByText("2026-09-24 21:00", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("UTC", { exact: true })).toHaveCount(0);
    });

    test("re-reads the list once the soonest run has passed, and only then", async ({
      page,
    }) => {
      // The list is not polled; the soonest run time sets one read. The first
      // answer has a run a moment away and the second the recomputed time, so
      // the row moving proves the read happened.
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
  test("reorders stops by menu, drag and keyboard, each with its actions, and saves in the order shown", async ({
    page,
  }) => {
    // Three ways to move a stop, and what is done there goes with it. Step ids
    // are positional, so a reorder that only moved the DOM would still post
    // the old order.
    const room = (id: string, name: string, x: number) =>
      vertex({ id, name, type: "MOVE", x, y: 2, theta: 0 });
    const a = room("aaaaaaaa-0000-0000-0000-00000000000a", "room-a", -6);
    const b = room("aaaaaaaa-0000-0000-0000-00000000000b", "room-b", -2);
    const c = room("aaaaaaaa-0000-0000-0000-00000000000c", "room-c", 2);
    await mockBackend(page, { vertices: [a, b, c] });
    // The create's echo is schema-checked, so this route replaces the
    // generic "ok", and reads the posted body.
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
    await page.goto("/tasks/editor");

    for (const [stop, name] of [[1, "room-a"], [2, "room-b"], [3, "room-c"]] as const) {
      await page.getByRole("button", { name: "Add a Move stop" }).click();
      await pickWaypoint(page, stop, name);
    }
    await addAction(page, "Speak", "on arrival at stop 3");
    await page.getByPlaceholder(/Delivery arrived/).fill("Hello");

    const order = () =>
      page
        .getByRole("combobox", { name: /^Waypoint for stop/ })
        .evaluateAll((items) => items.map((item) => item.textContent));
    await expect.poll(order).toEqual(["room-a", "room-b", "room-c"]);

    // Menu: the last stop up one.
    await page.getByRole("button", { name: "More actions for stop 3" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect.poll(order).toEqual(["room-a", "room-c", "room-b"]);
    // Its Speak went with it.
    await expect(page.getByRole("textbox", { name: "Say, on arrival at stop 2" })).toHaveValue(
      "Hello",
    );

    // Drag: the last stop's handle onto the first card.
    const cards = page.locator("[data-stop]");
    const handle = page.getByRole("button", { name: "Reorder stop 3" });
    const from = (await handle.boundingBox())!;
    const to = (await cards.first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(["room-b", "room-a", "room-c"]);

    // Keyboard: pick the last stop up, one slot up, drop — after the cards
    // have settled from the drop and been measured (see the announcement).
    await expect
      .poll(() =>
        cards.evaluateAll((items) => items.every((i) => i.getAnimations().length === 0)),
      )
      .toBe(true);
    const grip = page.getByRole("button", { name: "Reorder stop 3" });
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("is over position 3 of 3")).toBeAttached();
    // An ArrowUp under load is now and then dropped outright, so it is
    // pressed again, as an operator would.
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      await expect(page.getByText("is over position 2 of 3")).toBeAttached({
        timeout: 1_500,
      });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Space");
    await expect.poll(order).toEqual(["room-b", "room-c", "room-a"]);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Task name" }).fill("reorder-check");
    await page.keyboard.press("Enter");

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as { steps: { id: string; vertex_id?: string }[] };
    expect(body.steps.map((step) => [step.id, step.vertex_id])).toEqual([
      ["1-move", b.id],
      ["2-move", c.id],
      ["3-speak", undefined],
      ["4-move", a.id],
    ]);
  });

  test("moves an action along its stop, on to the next, and onto the walk", async ({ page }) => {
    // Move up and Move down cross into the next stop at a run's edge, and an
    // action on arrival can be done on the way instead: what is sent is the
    // list those moves make.
    const writes = await mockBackend(page, { vertices: [vertex()] });
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ id: "33333333-3333-3333-3333-333333333333" })),
      });
    });
    const posted: { steps: { id: string; group?: string }[] }[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/v1/task_templates")) {
        posted.push(request.postDataJSON());
      }
    });
    await page.goto("/tasks/editor");
    await page.getByRole("textbox", { name: "Task name" }).fill("walk-check");
    await page.getByRole("button", { name: "Add a Move stop" }).click();
    await pickWaypoint(page, 1, "dock");
    await addAction(page, "Wait", "on arrival at stop 1");
    await page.getByRole("textbox", { name: "Duration, on arrival at stop 1" }).fill("5");

    // Unfinished, the row says what it needs, and Save points at it.
    await addAction(page, "Speak", "on arrival at stop 1");
    await expect(page.getByText("Needs something to say.")).toBeVisible();
    await page.getByRole("textbox", { name: "Say, on arrival at stop 1" }).fill("Hello");

    // Up past the Wait, then onto the walk.
    await page.getByRole("button", { name: "More actions for Speak on arrival at stop 1" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await page.getByRole("button", { name: "More actions for Speak on arrival at stop 1" }).click();
    await page.getByRole("menuitem", { name: "Do on the way instead" }).click();
    await expect(page.getByRole("textbox", { name: "Say, on the way to stop 1" })).toHaveValue("Hello");

    // A body step is never offered the walk: the robot is already walking.
    await addAction(page, "Stand", "on arrival at stop 1");
    await page.getByRole("button", { name: "More actions for Stand on arrival at stop 1" }).click();
    await expect(page.getByRole("menuitem", { name: "Do on the way instead" })).toHaveCount(0);
    // Escape again until it takes: one sent before the menu takes focus
    // lands on the page and leaves the menu open over the next press.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    // Up from the top of the stop's arrival is before setting off.
    await page.getByRole("button", { name: "More actions for Wait on arrival at stop 1" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(page.getByRole("textbox", { name: "Duration, before setting off" })).toHaveValue("5");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps.map((step) => [step.id, step.group])).toEqual([
      ["1-wait", undefined],
      ["2-move", "g2"],
      ["3-speak", "g2"],
      ["4-standup", undefined],
    ]);
    expect(writes.filter((w) => w.path === "/api/v1/tasks")).toEqual([]);
  });

  test("saves a Wait step's duration as seconds, refusing one past the hour", async ({
    page,
  }) => {
    await mockBackend(page);
    const posted: { steps: unknown[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const body = request.postDataJSON() as { name: string; steps: unknown[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ name: body.name })),
      });
    });
    await page.goto("/tasks/editor");

    await addAction(page, "Wait");
    const duration = page.getByRole("textbox", { name: "Duration, before setting off" });
    await expect(duration).toBeVisible();

    // Past the backend's hour, the row says so and Save sends nothing — the
    // 422 would otherwise be a validation array on the operator's screen.
    await duration.fill("3601");
    await expect(page.getByText("At most 3600 seconds (1 hour).")).toBeVisible();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(
      page.locator("header").getByText(/^Some stops or actions are incomplete/),
    ).toBeVisible();
    expect(posted).toEqual([]);

    await duration.fill("90");
    await save.click();
    await page.getByRole("textbox", { name: "Task name" }).fill("pause at dock");
    await page.keyboard.press("Enter");
    await expect.poll(() => posted).toHaveLength(1);
    // The on-screen word is Duration; the wire field is `seconds`, a number.
    expect(posted[0]!.steps).toEqual([
      { id: "1-wait", type: "WAIT", params: { seconds: 90 } },
    ]);
    // And the summary adds it up.
    await expect(page.getByLabel("Job summary")).toHaveText(/1 min 30 s of waiting/);
  });

  test("builds its menus and its limits from the steps the robot describes", async ({
    page,
  }) => {
    // What the robot can do is its own to say: a step renamed there is
    // renamed here, a bound moved there is the one a draft is held to, and a
    // step this console cannot draw is left out rather than breaking the menu.
    const steps = taskSteps().steps.map((spec) =>
      spec.type === "SPEAK"
        ? { ...spec, label: "Announce" }
        : spec.type === "WAIT"
          ? {
              ...spec,
              params: (spec.params as Record<string, unknown>[]).map((field) => ({
                ...field,
                max: 600,
              })),
            }
          : spec,
    );
    steps.push({ type: "SCAN_QR", label: "Scan code", hint: "", occupies_body: false, params: [] });
    await mockBackend(page, { taskSteps: { steps } });
    const posted: { steps: unknown[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: unknown[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ name: body.name })),
      });
    });
    await page.goto("/tasks/editor");
    await page.getByRole("textbox", { name: "Task name" }).fill("short pause");

    await page.getByRole("button", { name: "Add an action before setting off" }).click();
    await expect(page.getByRole("menuitem", { name: /^Announce/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Speak/ })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /^Scan code/ })).toHaveCount(0);
    await page.getByRole("menuitem", { name: /^Wait/ }).click();

    const duration = page.getByRole("textbox", { name: "Duration, before setting off" });
    await duration.fill("601");
    await expect(page.getByText("At most 600 seconds (10 min).")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(posted).toEqual([]);

    await duration.fill("600");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps).toEqual([
      { id: "1-wait", type: "WAIT", params: { seconds: 600 } },
    ]);
  });

  test("waits out a conversion before drawing the floor plan it produced", async ({
    page,
  }) => {
    // A raster read mid-conversion is stale or half-written, and this cache
    // never goes stale on its own, so it is not read until the catalogue says
    // the conversion is over — including one another console started.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const entry = mapSummary({
      grid_status: "converting",
      grid_converting: true,
    });
    await mockBackend(page, { maps: [entry] });
    const imageReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/image")) imageReads.push(pathname);
    });
    await page.goto("/tasks/editor");
    // The map beside the stops has nothing to show yet, and says so.
    await expect(
      page.getByText("This map has no floor plan or 3D map to pick waypoints on."),
    ).toBeVisible();

    // Two catalogue polls' worth, while it still says converting.
    await page.waitForTimeout(4500);
    expect(imageReads).toEqual([]);

    entry.grid_status = "ok";
    entry.grid_converting = false;
    entry.modified_at = "2026-09-28T08:00:00Z";
    await expect(
      page.getByRole("img", { name: /^Floor plan of dp2f/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => imageReads, { timeout: 10_000 })
      .toEqual([`/api/v1/maps/${MAP_NAME}/image`]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("lights the job's stops on the map beside them", async ({
    page,
  }) => {
    // The map is beside the stops for the whole edit: every waypoint the job
    // goes to is lit and named with its stop numbers, for a screen reader too.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "MOVE",
      x: -3,
      y: 4,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room] });
    await page.goto("/tasks/editor");

    const plan = page.getByRole("img", {
      name: /^Floor plan of dp2f with 2 waypoints/,
    });
    await expect(plan).toBeVisible();
    // Nothing picked yet, so nothing is lit.
    await expect(plan).toHaveAccessibleName(/waypoints\.$/);

    // The pick is made on the card, and the map says where it went.
    await page.getByRole("button", { name: "Add a Move stop" }).click();
    await pickWaypoint(page, 1, "room-a");
    await expect(plan).toHaveAccessibleName(/; room-a is stop 1\.$/);

    // A second stop at the dock: both, in job order.
    await page.getByRole("button", { name: "Add a Move stop" }).click();
    await pickWaypoint(page, 2, "dock");
    await expect(plan).toHaveAccessibleName(/; room-a is stop 1, dock is stop 2\.$/);
    // And the list a stop is picked from says which stops already go where.
    await page.getByRole("combobox", { name: "Waypoint for stop 2" }).click();
    await expect(page.getByRole("option", { name: "room-a stop 1" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A click on the map away from any waypoint adds nothing.
    const box = (await plan.boundingBox())!;
    await page.mouse.click(box.x + 8, box.y + box.height - 8);
    await expect(page.locator("[data-stop]")).toHaveCount(2);
  });

  test("saves a Dock on the waypoint picked", async ({ page }) => {
    // A Dock rides the Move wire with its own type. Both halves asserted: the
    // card on screen, and the type, waypoint and map in the body.
    await mockBackend(page);
    const posted: { map_name?: string; steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as (typeof posted)[number] & { name: string };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "77777777-7777-7777-7777-777777777777", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("charge");

    await page.getByRole("button", { name: "Add a Dock stop" }).click();
    await pickWaypoint(page, 1, "dock");
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 1" })).toHaveText("dock");
    await expect(page.getByLabel("Job summary")).toHaveText(/ends docked at dock/);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.map_name).toBe(MAP_NAME);
    expect(posted[0]!.steps).toEqual([
      { id: "1-dock", type: "DOCK", params: { x: 2.5, y: 1.25, theta: 90 }, vertex_id: vertex().id },
    ]);
  });

  test("builds the route by clicking its waypoints on the map, after the stop selected", async ({ page }) => {
    // Each click on a waypoint is a stop, a charger a Dock — at the end, or
    // after the stop selected. Asserted on the cards and on the saved body,
    // whose order is the route.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "MOVE",
      x: -3,
      y: 4,
      theta: 0,
    });
    const hall = vertex({
      id: "55555555-5555-5555-5555-555555555555",
      name: "hall",
      type: "MOVE",
      x: 4,
      y: -3,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room, hall] });
    const posted: { steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as (typeof posted)[number] & { name: string };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "77777777-7777-7777-7777-777777777777", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await page.getByRole("textbox", { name: "Task name" }).fill("round");

    const plan = page.getByRole("img", { name: /^Floor plan of dp2f/ });
    await expect(plan).toBeVisible();
    // Where each waypoint is drawn, by the preview's own view transform.
    const box = (await plan.boundingBox())!;
    const view = previewView({ width: box.width, height: box.height }, PREVIEW_META);
    const screenOf = (stop: { x: number; y: number }) => {
      const at = vertexScreen(view, PREVIEW_META, stop.x, stop.y);
      return { x: box.x + at.cx, y: box.y + at.cy };
    };
    const roomAt = screenOf(room);
    const cards = page.locator("[data-stop]");

    // A drag that starts on a waypoint pans; it adds nothing.
    await page.mouse.move(roomAt.x, roomAt.y);
    await page.mouse.down();
    await page.mouse.move(roomAt.x + 40, roomAt.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(cards).toHaveCount(0);
    await page.getByRole("button", { name: "Fit to view" }).click();

    await page.mouse.click(roomAt.x, roomAt.y);
    const dockAt = screenOf(vertex());
    await page.mouse.click(dockAt.x, dockAt.y);
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Move");
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 1" })).toHaveText("room-a");
    await expect(cards.nth(1)).toContainText("Dock");
    await expect(plan).toHaveAccessibleName(/; room-a is stop 1, dock is stop 2\.$/);

    // With the first stop selected, the next click slots in after it.
    await cards.nth(0).getByText("Move", { exact: true }).click();
    await expect(page.getByText("Click a waypoint to add it as a stop after stop 1.")).toBeVisible();
    const hallAt = screenOf(hall);
    await page.mouse.click(hallAt.x, hallAt.y);
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 2" })).toHaveText("hall");

    // Undo takes the click back.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(cards).toHaveCount(2);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(cards).toHaveCount(3);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps).toMatchObject([
      { id: "1-move", type: "MOVE", vertex_id: room.id },
      { id: "2-move", type: "MOVE", vertex_id: hall.id },
      { id: "3-dock", type: "DOCK", vertex_id: vertex().id },
    ]);
  });

  test("builds the route by tapping waypoints on a map with only a 3D map", async ({ page }) => {
    // No floor plan to tap, so the map beside the stops is the 3D map. Both
    // halves: the cards on screen and the saved body.
    // A 4 m tree rather than the doormat default: at a doormat's framing
    // the camera is so close that a mark's few centimetres over the ground
    // are more than a tap's slop on screen. The stop stands at its middle.
    const lobby = vertex({ id: "a", name: "lobby", type: "MOVE", x: 2, y: 2, theta: 0, z: 0 });
    await mockBackend(page, {
      maps: [mapSummary({ grid: null, thumbnail: null, grid_status: "none", ...withOctomap() })],
      vertices: [lobby],
      octomap: octomapBt(40),
    });
    const posted: { map_name?: string; steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as (typeof posted)[number] & { name: string };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "77777777-7777-7777-7777-777777777777", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await page.getByRole("textbox", { name: "Task name" }).fill("lap");

    const view = page.getByTestId("route-canvas-3d");
    await expect(view).toBeVisible();
    // Only the 3D map to show, so no switch.
    await expect(page.getByRole("group", { name: "Show on" })).toHaveCount(0);

    // The stop stands where the opening view looks: the tree's middle.
    const box = (await view.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cards = page.locator("[data-stop]");

    // A drag from the stop orbits; it adds nothing.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 40, centre.y, { steps: 4 });
    await page.mouse.up();
    await expect(cards).toHaveCount(0);
    await page.getByRole("button", { name: "Fit to view" }).click();

    // Control: a tap on it does, and a second tap is the stop again.
    await page.mouse.click(centre.x, centre.y);
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 1" })).toHaveText("lobby");
    await page.mouse.click(centre.x, centre.y);
    await expect(cards).toHaveCount(2);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.map_name).toBe(MAP_NAME);
    expect(posted[0]!.steps).toMatchObject([
      { id: "1-move", type: "MOVE", vertex_id: "a" },
      { id: "2-move", type: "MOVE", vertex_id: "a" },
    ]);
  });

  test("offers the floor plan and the 3D map to pick on, for a map with both", async ({ page }) => {
    // The map editor's rule: the floor plan first, the 3D map a switch away.
    await mockBackend(page, { maps: [mapSummary({ ...withOctomap() })] });
    await page.goto("/tasks/editor");
    const views = page.getByRole("group", { name: "Show on" });
    await expect(views).toBeVisible();
    await expect(page.getByRole("img", { name: /^Floor plan of dp2f/ })).toBeVisible();
    await expect(page.getByTestId("route-canvas-3d")).toHaveCount(0);

    await views.getByRole("button", { name: "3D map" }).click();
    await expect(page.getByTestId("route-canvas-3d")).toBeVisible();
    await expect(page.getByRole("img", { name: /^Floor plan of dp2f/ })).toHaveCount(0);
  });

  test("zooms the floor plan and comes back to fit", async ({ page }) => {
    // At fit scale two waypoints a body length apart are one smear, so the
    // wheel, the buttons and Fit zoom; the scale is read off data-zoom.
    // A real 400 x 300 grid, so the raster has an extent to zoom into.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto("/tasks/editor");
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f/ });
    await expect(plan).toBeVisible();
    const zoom = page.locator("[data-zoom]");
    const readZoom = async () => Number(await zoom.getAttribute("data-zoom"));
    await expect.poll(readZoom).toBeGreaterThan(0);
    const fitted = await readZoom();

    // Wheel up over the map zooms in about the pointer.
    const box = (await plan.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -240);
    await expect.poll(readZoom).toBeGreaterThan(fitted);
    const wheeled = await readZoom();

    // The toolbar steps in and out, and Fit is the way back to the opening view.
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(readZoom).toBeLessThan(wheeled);
    await page.getByRole("button", { name: "Fit to view" }).click();
    await expect.poll(readZoom).toBe(fitted);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(readZoom).toBeGreaterThan(fitted);

    // Zooming out stops at the opening view, which already shows the whole
    // floor plan.
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole("button", { name: "Zoom out" }).click();
    }
    await expect.poll(readZoom).toBe(fitted);
  });

});

test.describe("what a dispatch records about itself", () => {
  // The history can only count and filter what the dispatch said it was:
  // its kind, and the template it came from.
  test("sends a saved job with its name and kind", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Dispatch "Morning round" now' })
      .click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const body = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      id: string;
      kind: string;
      name: string | null;
      map_name?: string;
      steps: unknown[];
    };
    expect(body.kind).toBe("task");
    expect(body.name).toBe("Morning round");
    // The map its coordinates were saved on, for the backend to check.
    expect(body.map_name).toBe(MAP_NAME);
    expect(body.id).toMatch(/^robot01-task-\d+-\d+$/);
    expect(body.steps).toHaveLength(1);
  });

  test("sends a posture as a motion key, not a task", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await page.getByRole("button", { name: "Lie down", exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/robot/set_motion_key"))
      .toHaveLength(1);
    expect(
      writes.find((w) => w.path === "/api/v1/robot/set_motion_key")!.body,
    ).toEqual({ key: "2" });
    expect(writes.filter((w) => w.path === "/api/v1/tasks")).toEqual([]);
  });

  test("stands and lies the robot down while any job runs", async ({ page }) => {
    // The reason postures are not tasks: a task is refused while any other
    // runs, and the operator must be able to change posture mid-job — one
    // that only speaks or one that drives.
    for (const job of [activeTask({ map_name: null }), activeTask()]) {
      const writes = await mockBackend(page, { activeTasks: [job] });
      await page.goto("/");

      await page.getByRole("button", { name: "Manual drive panel" }).click();
      await page.getByRole("button", { name: "Stand", exact: true }).click();
      await page.getByRole("button", { name: "Lie down", exact: true }).click();
      await expect
        .poll(() =>
          writes
            .filter((w) => w.path === "/api/v1/robot/set_motion_key")
            .map((w) => (w.body as { key: string }).key),
        )
        .toEqual(["0", "2"]);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });
});

test.describe("a job the robot refuses for its map", () => {
  // No console-error guard: the browser logs the 409 itself, which is the
  // response under test.
  test("shows the backend's sentence under the library", async ({ page }) => {
    await mockBackend(page);
    const refusal =
      "This job was planned on map dp2f, but the robot is using map wh1. Switch maps first.";
    await page.route("**/api/v1/tasks", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal, code: "map_mismatch" }),
          })
        : route.fallback(),
    );
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Dispatch "Morning round" now' })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  });
});

test.describe("a schedule edit the robot refuses", () => {
  // No console-error guard here: the browser logs the 404 itself, which is
  // exactly the response under test.
  test("keeps the edit open with the backend's sentence when it is refused", async ({
    page,
  }) => {
    await mockBackend(page, {
      schedules: [
        {
          id: "nightly",
          trigger: { interval_seconds: 1800 },
          paused: false,
          next_run_times: [],
        },
      ],
    });
    const refusal = "Schedule nightly not found";
    await page.route("**/api/v1/schedules/nightly", (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal }),
          })
        : route.fallback(),
    );
    await page.goto("/tasks");

    await page.getByRole("button", { name: "Edit schedule" }).click();
    // An interval opens as one, in the unit it reads best in.
    await expect(page.getByLabel("Every")).toHaveValue("30");
    await page.getByLabel("Every").fill("2");
    await page.getByRole("button", { name: "hours" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();

    // Under the form's own fields, not the list's error line.
    const row = page.getByRole("listitem").filter({ hasText: "Edit nightly" });
    await expect(row.getByRole("alert")).toHaveText(refusal);
    await expect(
      row.getByRole("button", { name: "Save schedule" }),
    ).toBeVisible();
  });
});
