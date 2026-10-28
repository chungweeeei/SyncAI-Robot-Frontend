import { expect, test } from "@playwright/test";

import {
  MAP_NAME,
  failOnConsoleErrors,
  mapSummary,
  mockBackend,
  recording,
  robotState,
  withoutOctomap,
} from "./backend";

/**
 * The words the operator reads: the house vocabulary, never an internal name.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
test.describe("words and names on the operator's screens", () => {
  // On-screen text names what the operator sees, never the stack, and every
  // control has a name a screen reader can say.
  let errors: string[];

  test.beforeEach(({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("says a recording is compressed without naming the format", async ({
    page,
  }) => {
    await mockBackend(page, {
      recordings: [recording({ compression: "zstd" })],
    });
    await page.goto("/recordings");

    await expect(page.getByText("Compressed", { exact: true })).toBeVisible();
    await expect(page.getByText("zstd")).toHaveCount(0);
  });

  test("names the running map in the header, not the file it was loaded from", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings");

    const header = page.getByRole("banner");
    await expect(header.getByText(MAP_NAME, { exact: true })).toBeVisible();
    await expect(header.getByText(/octomap\.bt|map\//)).toHaveCount(0);
  });

  test("follows a map switched from another console", async ({ page }) => {
    // The catalogue is not polled; the robot's own report is what says to
    // read it again.
    const state = robotState();
    const here = mapSummary({ name: MAP_NAME, active: true });
    const there = mapSummary({ name: "wh1", active: false });
    await mockBackend(page, { state, maps: [here, there] });
    await page.goto("/settings");
    const header = page.getByRole("banner");
    await expect(header.getByText(MAP_NAME, { exact: true })).toBeVisible();

    state.map = "map/wh1/octomap.bt";
    here.active = false;
    there.active = true;
    await expect(header.getByText("wh1", { exact: true })).toBeVisible();
  });

  test("names a motor the leg grid does not place by where it is", async ({
    page,
  }) => {
    // The driver's joint list can gain or rename a joint. Its reading is still
    // shown, but by a place on the robot, never by the driver's identifier.
    await mockBackend(page, {
      state: robotState({
        motor_status: [
          { name: "FL_Knee_joint", temperature: 41, error: 0 },
          { name: "FL_Ankle_joint", temperature: 44, error: 0 },
          { name: "waist_motor", temperature: 39, error: 0 },
        ],
      }),
    });
    await page.goto("/");

    const telemetry = page.getByRole("complementary", { name: "Telemetry" });
    await expect(
      telemetry.getByText("FL Ankle", { exact: true }),
    ).toBeVisible();
    await expect(
      telemetry.getByText("Other motor 1", { exact: true }),
    ).toBeVisible();
    await expect(telemetry.getByText(/_joint|waist_motor/)).toHaveCount(0);
  });

  test("names the settings pickers by the labels beside them", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings/preferences");

    await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Language" }),
    ).toBeVisible();
  });

  test("names the editor in the operator's words", async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/maps/${MAP_NAME}/edit?tool=waypoint`);
    await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
    await expect(page.getByText(/octomap|vertices/i)).toHaveCount(0);
  });

  test("says why a map with no 3D map cannot be edited, not the file it lacks", async ({
    page,
  }) => {
    await mockBackend(page, { maps: [mapSummary(withoutOctomap())] });
    await page.goto(`/maps/${MAP_NAME}/edit`);

    await expect(
      page.getByText("This map has no 3D map, so there is nothing to edit."),
    ).toBeVisible();
    await expect(page.getByText(/octomap/i)).toHaveCount(0);
  });
});
