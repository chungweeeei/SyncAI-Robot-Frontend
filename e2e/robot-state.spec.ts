import { expect, test, type Page } from "@playwright/test";

import {
  CONFIRM_NOT_CONVERGED,
  CONFIRM_NOT_NAVIGATING,
  INITIAL_POSE_JOB_RUNNING,
  START_LOCK_ERROR,
  START_LOCK_SILENT,
  START_LOCK_UNCONFIRMED,
  STATE_CHANGE_JOB_RUNNING,
  STATE_SILENT_HOLD,
} from "@/lib/robot/readiness";

import {
  ROBOT_STATE_STALE,
  activeTask,
  failOnConsoleErrors,
  gatedRobotState,
  mapSummary,
  mockBackend,
  robotState,
  robotStateSilence,
  taskHistoryEntry,
  taskState,
  taskTemplate,
} from "./backend";

/**
 * The robot's state machine on the console: the masthead's chip says the
 * state on every screen and is where it is changed by hand, the dashboard
 * offers Confirm position beside the live scan, and every way of starting a
 * job is greyed, with its reason, while the robot would refuse it.
 *
 * Each press is checked against what the console sent, and every greyed
 * button against a write log that stayed empty.
 */

/** The state on the masthead, a button or not: its title always names it. */
const chip = (page: Page) => page.getByRole("banner").getByTitle(/^Robot state:/);
/** The same, only where it opens: Unconfirmed, Idle, Error, a stuck job. */
const chipButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: /^Robot state:/ });
const panel = (page: Page) => page.getByRole("banner").getByRole("dialog", { name: "Robot state" });
const positionPanel = (page: Page) => page.getByRole("region", { name: "Robot position" });
const toolbar = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Viewport" }).getByRole("button", { name });

const stateWrites = (writes: { method: string; path: string; body: unknown }[]) =>
  writes.filter((w) => w.path === "/api/v1/robot/state");
const dispatches = (writes: { method: string; path: string }[]) =>
  writes.filter((w) => w.path === "/api/v1/tasks" && w.method === "POST");

/** A task that drives nowhere: the robot takes it on an unconfirmed position. */
const greeting = () =>
  taskTemplate({
    id: "33333333-3333-3333-3333-333333333333",
    name: "Greeting",
    map_name: null,
    steps: [
      {
        id: "1-speak",
        vertex_id: null,
        vertex_name: null,
        vertex_status: "NONE",
        type: "SPEAK",
        params: { text: "Hello" },
        resolved_params: { text: "Hello" },
      },
    ],
  });

test.describe("the robot's state", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  // The refusal tests answer 409 on purpose, which Chromium logs as "Failed
  // to load resource" (auto-localize.spec.ts records the same exception).
  test.afterEach(() => {
    expect(
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  test("says nothing about the pose tools while no job runs", async ({ page }) => {
    // The positive control for the line above: it is the job's, not always there.
    await mockBackend(page, { state: gatedRobotState({ state: "IDLE", state_message: "" }) });
    await page.goto("/");
    await expect(toolbar(page, "Set initial pose")).toBeEnabled();
    await expect(page.getByText(INITIAL_POSE_JOB_RUNNING)).toHaveCount(0);
  });

  test("draws no chip and holds nothing for a backend from before the state machine", async ({
    page,
  }) => {
    // Its UNINITIALIZED meant only "no pose yet" and refused no job; a chip
    // reading Unconfirmed with no Confirm behind it would be a dead end.
    await mockBackend(page, { state: robotState({ state: "UNINITIALIZED" }) });
    await page.goto("/");

    // The positive control: the strip is up and the mode chip is on it.
    await expect(page.getByRole("banner").getByTitle("Navigation")).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
    await expect(positionPanel(page)).toHaveCount(0);
    await expect(toolbar(page, "Set goal")).toBeEnabled();

    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: 'Run "Morning round" now' })).toBeEnabled();
  });

  test("says the state on the masthead and confirms the position from it", async ({ page }) => {
    const writes = await mockBackend(page, { state: gatedRobotState() });
    await page.goto("/settings");

    await expect(chip(page)).toHaveText("Unconfirmed");
    await chip(page).click();
    // The robot's own sentence, verbatim.
    await expect(panel(page)).toContainText(
      "Waiting for an operator to confirm the robot's position.",
    );
    await panel(page).getByRole("button", { name: "Confirm position" }).click();

    await expect.poll(() => stateWrites(writes)).toEqual([
      { method: "POST", path: "/api/v1/robot/state", body: { state: "IDLE" } },
    ]);
    // The chip is the reading: it moves on the robot's next frame.
    await expect(chip(page)).toHaveText("Idle");
    await expect(panel(page)).toContainText("Position confirmed.");
    // And the control is now the way back.
    await expect(panel(page).getByRole("button", { name: "Confirm position" })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Mark unconfirmed" }).click();
    await expect(chip(page)).toHaveText("Unconfirmed");
    expect(stateWrites(writes).map((w) => w.body)).toEqual([
      { state: "IDLE" },
      { state: "UNINITIALIZED" },
    ]);
  });

  test("greys Confirm, with the reason, until the robot has found its position", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: gatedRobotState({ localization_converged: false }),
    });
    await page.goto("/");

    // On the masthead and on the dashboard alike, each saying why in a line.
    await chip(page).click();
    const fromChip = panel(page).getByRole("button", { name: "Confirm position" });
    await expect(fromChip).toBeDisabled();
    await expect(panel(page)).toContainText(CONFIRM_NOT_CONVERGED);
    const fromDashboard = positionPanel(page).getByRole("button", { name: "Confirm position" });
    await expect(fromDashboard).toBeDisabled();
    await expect(positionPanel(page)).toContainText(CONFIRM_NOT_CONVERGED);

    await fromChip.click({ force: true });
    await fromDashboard.click({ force: true });
    expect(stateWrites(writes)).toEqual([]);
  });

  test("offers Confirm beside the live scan, and opens the goal tools with it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { state: gatedRobotState() });
    await page.goto("/");

    await expect(positionPanel(page)).toContainText("Unconfirmed");
    await expect(positionPanel(page)).toContainText("Check the live scan against the map");
    // A goal drives on the map, so it is held; setting the pose is not.
    await expect(toolbar(page, "Set goal")).toBeDisabled();
    await expect(toolbar(page, "Set initial pose")).toBeEnabled();
    await toolbar(page, "Set goal").click({ force: true });
    await expect(toolbar(page, "Set goal")).toHaveAttribute("aria-pressed", "false");

    await positionPanel(page).getByRole("button", { name: "Confirm position" }).click();

    await expect.poll(() => stateWrites(writes).map((w) => w.body)).toEqual([{ state: "IDLE" }]);
    // The panel goes with the state it was for; the chip is the reading.
    await expect(positionPanel(page)).toHaveCount(0);
    await expect(chip(page)).toHaveText("Idle");
    await expect(toolbar(page, "Set goal")).toBeEnabled();
    expect(dispatches(writes)).toEqual([]);
  });

  test("holds a task that drives on the map and still runs one that does not", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: gatedRobotState(),
      templates: [taskTemplate(), greeting()],
    });
    await page.goto("/tasks");

    const drive = page.getByRole("button", { name: 'Run "Morning round" now' });
    await expect(drive).toBeDisabled();
    await expect(page.getByText(START_LOCK_UNCONFIRMED)).toBeVisible();
    await drive.click({ force: true });
    expect(dispatches(writes)).toEqual([]);

    // Speaking needs no position, and the robot takes it.
    await page.getByRole("button", { name: 'Run "Greeting" now' }).click();
    await expect.poll(() => dispatches(writes)).toHaveLength(1);
  });

  test("holds every job while an error is latched, and releases it from the chip", async ({
    page,
  }) => {
    const reason = "The last job failed: there is no way through to the goal.";
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "ERROR", state_message: reason }),
      templates: [taskTemplate(), greeting()],
    });
    await page.goto("/tasks");

    await expect(chip(page)).toHaveText("Error");
    // Any kind, the one that drives nowhere included.
    for (const name of ['Run "Morning round" now', 'Run "Greeting" now']) {
      const run = page.getByRole("button", { name });
      await expect(run).toBeDisabled();
      await run.click({ force: true });
    }
    await expect(page.getByText(START_LOCK_ERROR)).toBeVisible();
    expect(dispatches(writes)).toEqual([]);

    await chip(page).click();
    await expect(panel(page)).toContainText(reason);
    // One way out, and it confirms the position: no release leaves it
    // unconfirmed.
    await expect(panel(page).getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Release without confirming" })).toHaveCount(0);
    await panel(page).getByRole("button", { name: "Release and confirm position" }).click();

    await expect.poll(() => stateWrites(writes).map((w) => w.body)).toEqual([{ state: "IDLE" }]);
    await expect(chip(page)).toHaveText("Idle");
    for (const name of ['Run "Greeting" now', 'Run "Morning round" now']) {
      await expect(page.getByRole("button", { name })).toBeEnabled();
    }
  });

  test("greys the dashboard's goal tools on an error and says where to release it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { state: gatedRobotState({ state: "ERROR" }) });
    await page.goto("/");

    await expect(toolbar(page, "Set goal")).toBeDisabled();
    await expect(page.getByRole("main").getByText(START_LOCK_ERROR)).toBeVisible();
    // Confirm position is the masthead's here: the dashboard's is for an
    // unconfirmed position alone.
    await expect(positionPanel(page)).toHaveCount(0);
    await toolbar(page, "Set goal").click({ force: true });
    expect(dispatches(writes)).toEqual([]);
  });

  test("greys every state change and Set initial pose while a job runs", async ({ page }) => {
    const id = "robot01-task-1758000000-1";
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "ERROR" }),
      activeTasks: [activeTask()],
      taskStates: { [id]: taskState() },
    });
    await page.goto("/");

    await chip(page).click();
    const release = panel(page).getByRole("button", { name: "Release and confirm position" });
    await expect(release).toBeDisabled();
    await release.click({ force: true });
    await expect(panel(page).getByText(STATE_CHANGE_JOB_RUNNING)).toHaveCount(1);
    // A press outside closes it, as a menu does.
    await page.getByRole("main").click({ position: { x: 600, y: 400 } });
    await expect(panel(page)).toHaveCount(0);

    // A new pose would move the map under the job; the backend refuses it,
    // and the reason is a line, since a greyed button takes no hover.
    const pose = toolbar(page, "Set initial pose");
    await expect(pose).toBeDisabled();
    await expect(page.getByRole("main").getByText(INITIAL_POSE_JOB_RUNNING)).toBeVisible();
    await pose.click({ force: true });
    await expect(pose).toHaveAttribute("aria-pressed", "false");

    expect(stateWrites(writes)).toEqual([]);
    expect(writes.filter((w) => w.path === "/api/v1/robot/set_initial_pose")).toEqual([]);
  });

  test("offers nothing while a job runs, and to clear one the list no longer has", async ({
    page,
  }) => {
    // A run ended from outside never reports its end: the robot still counts
    // it, and would refuse every later job as busy.
    const id = "robot01-task-1758000000-1";
    const tasks = [activeTask()];
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "RUNNING", state_message: "Running a job." }),
      activeTasks: tasks,
      taskStates: { [id]: taskState() },
    });
    await page.goto("/settings");

    // Running opens nothing: a job is ended from its own controls. Its
    // sentence is the hover title.
    await expect(chip(page)).toHaveText("Running");
    await expect(chip(page)).toHaveAttribute("title", "Robot state: Running — Running a job.");
    await expect(chipButton(page)).toHaveCount(0);

    // The job leaves the list; the robot goes on saying it runs.
    tasks.length = 0;
    await expect(chipButton(page)).toHaveAccessibleName("Robot state: Running", {
      timeout: 15_000,
    });
    await chipButton(page).click();
    await expect(panel(page)).toContainText("none is listed");
    const clear = panel(page).getByRole("button", { name: "Clear the stuck job" });
    await clear.click();

    await expect.poll(() => stateWrites(writes).map((w) => w.body)).toEqual([{ state: "IDLE" }]);
    await expect(chip(page)).toHaveText("Idle");
  });

  test("a refusal is the backend's sentence, where it was pressed", async ({ page }) => {
    await mockBackend(page, { state: gatedRobotState() });
    const sentence = "The robot has not found its position on the map yet.";
    await page.route("**/api/v1/robot/state", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: sentence, code: "not_converged" }),
          })
        : route.fallback(),
    );
    await page.goto("/");

    await positionPanel(page).getByRole("button", { name: "Confirm position" }).click();

    await expect(positionPanel(page)).toContainText(sentence);
    // Nothing changed, and nothing claims it did.
    await expect(chip(page)).toHaveText("Unconfirmed");
    await expect(toolbar(page, "Set goal")).toBeDisabled();
  });

  test("cannot confirm in Mapping mode, where there is no map to be on", async ({ page }) => {
    const writes = await mockBackend(page, { state: gatedRobotState({ mode: "MANUAL" }) });
    await page.goto("/");

    // The dashboard's Confirm is Navigation's alone.
    await expect(chip(page)).toHaveText("Unconfirmed");
    await expect(positionPanel(page)).toHaveCount(0);
    await chip(page).click();
    const confirm = panel(page).getByRole("button", { name: "Confirm position" });
    await expect(confirm).toBeDisabled();
    await expect(panel(page)).toContainText(CONFIRM_NOT_NAVIGATING);
    await confirm.click({ force: true });
    expect(stateWrites(writes)).toEqual([]);
  });

  test("holds a failed job's Retry until the error is released", async ({ page }) => {
    // The history's default window reaches back a day from now, and the
    // fixture's job closed on 2026-09-18 (history.spec.ts fixes the same).
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
    const id = "nightly-2026-09-18T01:00:00Z";
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "ERROR" }),
      taskHistory: [
        taskHistoryEntry({
          id,
          run_id: "run-2",
          status: "FAILED",
          started_at: "2026-09-18T01:00:00Z",
          closed_at: "2026-09-18T01:12:30Z",
          source: "SCHEDULE",
          schedule_id: "nightly",
          kind: "schedule",
          name: "Morning round",
        }),
      ],
      taskStates: {
        [id]: {
          id,
          status: "FAILED",
          steps: [
            { id: "1-move", status: "COMPLETED", error_msg: "" },
            { id: "2-move", status: "FAILED", error_msg: "Goal is blocked." },
          ],
        },
      },
    });
    await page.goto("/history");
    await page.getByText("Morning round").click();

    const retry = page.getByRole("button", { name: "Retry from step 2" });
    await expect(retry).toBeDisabled();
    await expect(page.getByRole("main").getByText(START_LOCK_ERROR)).toBeVisible();
    await retry.click({ force: true });
    expect(dispatches(writes)).toEqual([]);

    await chip(page).click();
    await panel(page).getByRole("button", { name: "Release and confirm position" }).click();
    await expect(retry).toBeEnabled();
  });

  test("stops showing a state the robot has stopped reporting, until it reports again", async ({
    page,
  }) => {
    // The console keeps the last frame through a failed poll. Its word is a
    // memory by then: an "Idle" over a robot nobody is hearing from.
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "IDLE", state_message: "" }),
    });
    const robot = await robotStateSilence(page);
    await page.goto("/settings");
    const strip = page.getByRole("banner");

    await expect(chip(page)).toHaveText("Idle");
    await chip(page).click();
    const withdraw = panel(page).getByRole("button", { name: "Mark unconfirmed" });
    await expect(withdraw).toBeEnabled();
    // The positive control: no link chip while frames arrive.
    await expect(strip.getByText("Last seen")).toHaveCount(0);

    robot.silent = true;

    // The link chip is what says so, with the backend's sentence on hover;
    // the state chip goes to a dash rather than say it a second time.
    await expect(strip.getByText("Last seen")).toHaveAttribute("title", ROBOT_STATE_STALE);
    await expect(chip(page)).toHaveText("—");
    await expect(chip(page)).toHaveAttribute(
      "title",
      `Robot state: not reported — ${ROBOT_STATE_STALE}`,
    );
    await expect(strip.getByText("Idle")).toHaveCount(0);
    // Nothing is offered on a state nobody is reporting: the open popover
    // closes, and the dash is not a button.
    await expect(panel(page)).toHaveCount(0);
    await expect(chipButton(page)).toHaveCount(0);
    // The rest of the last frame is still shown, as it always was.
    await expect(strip.getByRole("link", { name: "robot01" })).toBeVisible();

    robot.silent = false;

    await expect(chip(page)).toHaveText("Idle");
    await expect(strip.getByText("Last seen")).toHaveCount(0);
    // Not reopened by itself: nobody asked since.
    await expect(panel(page)).toHaveCount(0);
    await chip(page).click();
    await expect(withdraw).toBeEnabled();
    await withdraw.click();
    await expect.poll(() => stateWrites(writes).map((w) => w.body)).toEqual([
      { state: "UNINITIALIZED" },
    ]);
  });

  test("holds the dashboard's Confirm with the reading, and keeps the last hold on goals", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { state: gatedRobotState() });
    const robot = await robotStateSilence(page);
    await page.goto("/");

    const confirm = positionPanel(page).getByRole("button", { name: "Confirm position" });
    await expect(confirm).toBeEnabled();
    await expect(toolbar(page, "Set goal")).toBeDisabled();

    robot.silent = true;

    // Nothing to confirm on a state nobody is reporting. The panel stays
    // where the finger is, says so in the chip's words, and holds Confirm.
    await expect(chip(page)).toHaveText("—");
    await expect(positionPanel(page)).toContainText(ROBOT_STATE_STALE);
    await expect(positionPanel(page)).toContainText(STATE_SILENT_HOLD);
    await expect(positionPanel(page)).not.toContainText("Unconfirmed");
    await expect(confirm).toBeDisabled();
    await confirm.click({ force: true });
    // Nothing on the dashboard repeats the last frame's word.
    await expect(page.getByRole("main").getByText(START_LOCK_UNCONFIRMED)).toHaveCount(0);
    // The masthead follows the same rule: the dash offers nothing.
    await expect(chipButton(page)).toHaveCount(0);
    // The goal tools stay as the last frame left them, as every gate here
    // judges by the last frame.
    await expect(toolbar(page, "Set goal")).toBeDisabled();
    expect(stateWrites(writes)).toEqual([]);

    robot.silent = false;

    await expect(chip(page)).toHaveText("Unconfirmed");
    await expect(positionPanel(page)).toContainText("Unconfirmed");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => stateWrites(writes).map((w) => w.body)).toEqual([{ state: "IDLE" }]);
    await expect(chip(page)).toHaveText("Idle");
    await expect(toolbar(page, "Set goal")).toBeEnabled();
  });

  test("says Run is held because the robot is silent, not by its last word", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: gatedRobotState({ state: "ERROR", state_message: "The last job failed." }),
      templates: [taskTemplate()],
    });
    const robot = await robotStateSilence(page);
    await page.goto("/tasks");
    const run = page.getByRole("button", { name: 'Run "Morning round" now' });
    await expect(page.getByText(START_LOCK_ERROR)).toBeVisible();

    robot.silent = true;

    await expect(page.getByText(START_LOCK_SILENT)).toBeVisible();
    await expect(page.getByText(START_LOCK_ERROR)).toHaveCount(0);
    await expect(run).toBeDisabled();
    await run.click({ force: true });
    expect(dispatches(writes)).toEqual([]);

    robot.silent = false;
    await expect(page.getByText(START_LOCK_ERROR)).toBeVisible();
  });

  test("says, on a map switch, that the position has to be confirmed again", async ({ page }) => {
    await mockBackend(page, {
      state: gatedRobotState({ state: "IDLE", state_message: "" }),
      maps: [
        mapSummary({ active: true, name: "site-a" }),
        mapSummary({ active: false, name: "site-b" }),
      ],
    });
    await page.goto("/maps");

    await page.getByRole("button", { name: "Switch the robot to site-b" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "confirm the robot's position — it will not drive on the map until you do",
    );
  });
});
