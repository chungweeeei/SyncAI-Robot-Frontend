import { expect, test, type Page } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/**
 * The mapping rail against the robot's run state.
 *
 * The run is bracketed by two presses — Start mapping, then Save — and the
 * rail's job is to offer only the one the robot would accept, read off
 * GET /mapping rather than off a flag this tab set. So every test here moves
 * the fake's state the way the robot's would and asserts what the rail
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

  const startButton = (page: Page) => page.getByRole("button", { name: "Start mapping" });
  const saveButton = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
  const resetButton = (page: Page) => page.getByRole("button", { name: "Start a new map" });
  const mapping = () => robotState({ mode: "MANUAL", localization_valid: false });

  test("offers Start while idle and holds Save and New map", async ({ page }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");

    await expect(page.getByText("Idle — press Start mapping")).toBeVisible();
    await expect(startButton(page)).toBeEnabled();
    await expect(saveButton(page)).toBeDisabled();
    await expect(resetButton(page)).toBeDisabled();
  });

  test("starts the run and the rail follows the robot's status", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");

    await startButton(page).click();

    expect(writes.filter((w) => w.path === "/api/v1/mapping/start")).toEqual([
      { method: "POST", path: "/api/v1/mapping/start", body: null },
    ]);
    // The robot's sentence, with its stillness warning, verbatim.
    await expect(page.getByText(/keep the robot still/)).toBeVisible();
    // The next poll says mapping: Save lights up, Start goes dark.
    await expect(page.getByText("Mapping · 0 keyframes")).toBeVisible();
    await expect(saveButton(page)).toBeDisabled(); // no name typed yet
    await expect(resetButton(page)).toBeEnabled();
    await expect(startButton(page)).toBeDisabled();
  });

  test("saving ends the run and offers Start again", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "mapping", key_poses: 12, loop_closures: 1 },
    });
    await page.goto("/mapping");
    await expect(page.getByText("Mapping · 12 keyframes")).toBeVisible();
    await expect(startButton(page)).toBeDisabled();

    await page.getByLabel("Map name").fill("site_a");
    await saveButton(page).click();

    expect(writes.filter((w) => w.path === "/api/v1/maps")).toEqual([
      { method: "POST", path: "/api/v1/maps", body: { name: "site_a" } },
    ]);
    await expect(page.getByText(/Mapping has stopped/)).toBeVisible();
    await expect(page.getByText("Idle — press Start mapping")).toBeVisible();
    await expect(startButton(page)).toBeEnabled();
    await expect(resetButton(page)).toBeDisabled();
  });

  test("in Navigation the whole run rail is held", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/mapping");

    await expect(startButton(page)).toBeDisabled();
    await expect(page.getByText("Starting a map needs mapping mode.")).toBeVisible();
    await expect(saveButton(page)).toBeDisabled();
    await expect(resetButton(page)).toBeDisabled();
  });

  test("leaving Mapping while idle is a plain switch, mid-run it warns", async ({
    page,
  }) => {
    await mockBackend(page, {
      state: mapping(),
      mappingStatus: { state: "idle", key_poses: 0, loop_closures: 0 },
    });
    await page.goto("/mapping");
    await expect(page.getByText("Idle — press Start mapping")).toBeVisible();

    await page.getByRole("button", { name: "Navigation" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Switch to Nav mode?");
    await page.getByRole("button", { name: "Cancel" }).click();

    // A run is now in RAM and unsaved: the same switch asks the loud question.
    await startButton(page).click();
    await expect(page.getByText("Mapping · 0 keyframes")).toBeVisible();
    await page.getByRole("button", { name: "Navigation" }).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "Leave mapping without saving?",
    );
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
    // Nothing changed on the robot, so the rail still offers Start.
    await expect(startButton(page)).toBeEnabled();
  });
});
