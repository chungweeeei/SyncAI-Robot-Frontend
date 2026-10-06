import { expect, test, type Page } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/**
 * The mapping run strip against the robot's run state.
 *
 * The run is bracketed by two presses — Start mapping, then Save — and the
 * strip's job is to offer only the one the robot would accept, read off
 * GET /mapping rather than off a flag this tab set. So every test here moves
 * the fake's state the way the robot's would and asserts what the strip
 * offers next, plus the one write each press promised.
 */
test.describe("the mapping run", () => {
  let errors: string[];

  test.beforeEach(({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    // A refused start is a logged resource error (the 409), the same way a
    // refused restart is in settings.spec.ts; the sentence on screen is the
    // assertion, not the absence of the log line.
    expect(
      errors.filter((e) => !/Failed to load resource/.test(e)),
      "the page logged errors",
    ).toEqual([]);
  });

  const strip = (page: Page) => page.getByRole("group", { name: "Mapping run" });
  const startButton = (page: Page) => strip(page).getByRole("button", { name: "Start mapping" });
  // Scoped to the strip: while the dialog is open there is a second Save in it.
  const saveButton = (page: Page) => strip(page).getByRole("button", { name: "Save", exact: true });
  const resetButton = (page: Page) => strip(page).getByRole("button", { name: "New map" });
  const dialog = (page: Page) => page.getByRole("alertdialog");
  const mapping = () => robotState({ mode: "MANUAL", localization_valid: false });

  test("offers Start while idle and nothing else", async ({ page }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");

    await expect(startButton(page)).toBeEnabled();
    // Not greyed: absent. An idle robot has nothing to save or discard, and a
    // held Save under a Start button would be the old rail in a smaller box.
    await expect(saveButton(page)).toHaveCount(0);
    await expect(resetButton(page)).toHaveCount(0);
    await expect(strip(page).getByRole("status")).toHaveCount(0);
    // The map so far is always on: no layer toggle, and no stream pills.
    await expect(page.getByRole("button", { name: "Map so far" })).toHaveCount(0);
    await expect(page.getByText(/^(Scan|Map) live$/)).toHaveCount(0);
  });

  test("starts the run and the strip follows the robot's status", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");

    await startButton(page).click();

    expect(writes.filter((w) => w.path === "/api/v1/mapping/start")).toEqual([
      { method: "POST", path: "/api/v1/mapping/start", body: null },
    ]);
    // The next poll says mapping: Start gives way to the indicator, Save and
    // New map light up. The indicator is the dot alone; its word is for a
    // screen reader.
    await expect(strip(page).getByRole("status")).toHaveText("Mapping");
    await expect(saveButton(page)).toBeEnabled();
    await expect(resetButton(page)).toBeEnabled();
    await expect(startButton(page)).toHaveCount(0);
    // A start that was accepted leaves no sentence under the strip.
    await expect(page.getByText(/keep the robot still/)).toHaveCount(0);
  });

  test("saving asks for the name, shows the receipt, and offers Start again", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "mapping", key_poses: 12, loop_closures: 1 },
    });
    await page.goto("/mapping");
    await expect(strip(page).getByRole("status")).toHaveText("Mapping");
    await expect(startButton(page)).toHaveCount(0);

    await saveButton(page).click();
    await expect(dialog(page)).toContainText("Save this map?");
    await dialog(page).getByLabel("Map name").fill("site_a");
    await dialog(page).getByRole("button", { name: "Save", exact: true }).click();

    expect(writes.filter((w) => w.path === "/api/v1/maps")).toEqual([
      { method: "POST", path: "/api/v1/maps", body: { name: "site_a" } },
    ]);
    // The dialog stays and turns into the receipt: the form is gone, the
    // robot's sentence is there, and the only way out is Close.
    await expect(dialog(page)).toContainText(/Mapping has stopped/);
    await expect(dialog(page).getByLabel("Map name")).toHaveCount(0);
    await expect(dialog(page).getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toHaveCount(0);

    // The strip has followed the robot back to idle, and the receipt went
    // with the dialog: nothing under the strip repeats it.
    await expect(startButton(page)).toBeEnabled();
    await expect(resetButton(page)).toHaveCount(0);
    await expect(page.getByText(/Mapping has stopped/)).toHaveCount(0);
  });

  test("a refused save stays in the dialog and never reaches the strip", async ({
    page,
  }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "mapping", key_poses: 12, loop_closures: 1 },
    });
    await page.route("**/api/v1/maps", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "A map named 'site_a' already exists." }),
      });
    });
    await page.goto("/mapping");

    await saveButton(page).click();
    await dialog(page).getByLabel("Map name").fill("site_a");
    await dialog(page).getByRole("button", { name: "Save", exact: true }).click();

    // The backend's own sentence, in the dialog, with the form still there
    // to fix the name.
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "A map named 'site_a' already exists.",
    );
    await expect(dialog(page).getByLabel("Map name")).toHaveValue("site_a");

    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    // Backed out of, so it is not a thing the strip has to report.
    await expect(page.getByText(/already exists/)).toHaveCount(0);
    await expect(saveButton(page)).toBeEnabled();
  });

  test("in Navigation the strip offers only a held Start, and says why", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/mapping");

    await expect(startButton(page)).toBeDisabled();
    await expect(startButton(page)).toHaveAttribute(
      "title",
      "Starting a map needs mapping mode.",
    );
    await expect(saveButton(page)).toHaveCount(0);
    await expect(resetButton(page)).toHaveCount(0);
  });

  test("leaving Mapping while idle is a plain switch, mid-run it warns", async ({
    page,
  }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");
    await expect(startButton(page)).toBeEnabled();

    await page.getByRole("button", { name: "Navigation" }).click();
    await expect(dialog(page)).toContainText("Switch to Nav mode?");
    await page.getByRole("button", { name: "Cancel" }).click();

    // A run is now in RAM and unsaved: the same switch asks the loud question.
    await startButton(page).click();
    await expect(strip(page).getByRole("status")).toHaveText("Mapping");
    await page.getByRole("button", { name: "Navigation" }).click();
    await expect(dialog(page)).toContainText("Leave mapping without saving?");
  });

  test("New map goes through the confirm, and the strip follows the reset", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "mapping", key_poses: 12, loop_closures: 1 },
    });
    await page.goto("/mapping");

    await resetButton(page).click();
    await expect(dialog(page)).toContainText("Start a new map?");
    // Nothing is sent until the operator says so.
    expect(writes.filter((w) => w.path === "/api/v1/mapping/reset")).toEqual([]);

    await dialog(page).getByRole("button", { name: "Discard and start over" }).click();

    expect(writes.filter((w) => w.path === "/api/v1/mapping/reset")).toEqual([
      { method: "POST", path: "/api/v1/mapping/reset", body: null },
    ]);
    await expect(strip(page).getByRole("status")).toHaveText("Mapping");
    // An accepted reset leaves no sentence under the strip; only a refusal does.
    await expect(page.getByText(/Map discarded/)).toHaveCount(0);
  });

  test("a refused start is shown in the robot's words", async ({ page }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.route("**/api/v1/mapping/start", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "LIO reset service /robot01/pointlio/reset is not available; nothing started",
        }),
      }),
    );
    await page.goto("/mapping");

    await startButton(page).click();

    await expect(page.getByText(/nothing started/)).toBeVisible();
    // Nothing changed on the robot, so the strip still offers Start.
    await expect(startButton(page)).toBeEnabled();
  });
});
