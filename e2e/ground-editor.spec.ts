import { expect, test, type Page } from "@playwright/test";

import { encodeOctomapBt } from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  mapSummary,
  mockBackend,
  taskState,
  TWO_FLOORS,
  withOctomap,
} from "./backend";

/**
 * The ground editor: the fake's doormat-sized 3D map is a 4×4 floor with a
 * 2×2 hole in the middle (see octomapBt in backend.ts), half a metre under
 * the origin. Every test asserts what the console sent — the record is what
 * the robot's tool applies, so a screen that says "4 cells" over a PUT of
 * the wrong keys would pass a screen-only test.
 */

const O = OCTREE_KEY_ORIGIN;
const editsPath = `/api/v1/maps/${MAP_NAME}/octomap/edits`;

/** The hole's four columns as the backend records them: ky up, kz the floor's. */
const HOLE = [
  [O + 1, O + 1, O - 5],
  [O + 2, O + 1, O - 5],
  [O + 1, O + 2, O - 5],
  [O + 2, O + 2, O - 5],
];

const byKey = (keys: number[][]) =>
  [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

/**
 * Where the hole is on screen: the middle of the canvas. The editor opens
 * looking at the middle of the map on the floor the brush aims at
 * (frameGround), so the ray through the canvas's centre meets that floor at
 * the map's centre, which on the fake is the middle of its hole.
 */
async function holeOnScreen(page: Page) {
  const box = (await page.getByTestId("ground-canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function armFill(page: Page, radius = "0.1 m") {
  await page.getByRole("button", { name: "Fill" }).click();
  await page.getByRole("combobox", { name: "Brush radius" }).click();
  await page.getByRole("option", { name: radius, exact: true }).click();
}

const patched = (page: Page) => page.locator("[data-patched]");

test.describe("the ground editor", () => {
  test("is reached from the card only for a map with a 3D map", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, {
      maps: [
        mapSummary({ name: "flat", active: false }),
        mapSummary({ name: "solid", active: true, ...withOctomap() }),
      ],
    });
    await page.goto("/maps");
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();

    await expect(page.getByRole("link", { name: "Fill the ground of flat" })).toHaveCount(0);
    const link = page.getByRole("link", { name: "Fill the ground of solid" });
    await expect(link).toHaveAttribute("href", "/maps/solid/ground");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("fills the hole at the floor's height, and saves exactly those columns", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await expect(page.getByTestId("ground-canvas")).toBeVisible();
    await expect(patched(page)).toHaveAttribute("data-patched", "0");

    // Orbit is the opening tool: a press turns the map, it never paints.
    const hole = await holeOnScreen(page);
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "0");

    await armFill(page);
    // A one-cell brush is a 3×3 block: it covers the hole and the floor round
    // it, and only the hole is filled.
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    // The floor round the hole is 0.45 m below the origin: what the fill reads,
    // proved by the saved keys' height below (HOLE's kz).

    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Saved 4 ground patches" })).toBeVisible();
    await expect(save).toBeDisabled();

    const put = writes.find((write) => write.method === "PUT" && write.path === editsPath);
    expect(put).toBeDefined();
    expect(byKey((put!.body as { fill_key: number[][] }).fill_key)).toEqual(byKey(HOLE));
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("erases its own patches and nothing else, and undo brings them back", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomapEdits: { [MAP_NAME]: HOLE },
    });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await expect(page.getByTestId("ground-canvas")).toBeVisible();
    // The saved record is what it opens on, and is not unsaved.
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    await page.getByRole("button", { name: "Erase" }).click();
    const hole = await holeOnScreen(page);
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "0");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(patched(page)).toHaveAttribute("data-patched", "0");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cleared" })).toBeVisible();
    const put = writes.find((write) => write.method === "PUT" && write.path === editsPath);
    expect((put!.body as { fill_key: number[][] }).fill_key).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("holds Save while a job drives on the map, and keeps the strokes", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const job = activeTask();
    const running = [job];
    // The masthead keeps reading the job after it leaves the list, for one
    // poll: given its ending here rather than a 404, which the console-error
    // guard would count.
    const states: Record<string, Record<string, unknown>> = {};
    const writes = await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      activeTasks: running,
      taskStates: states,
    });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await expect(page.getByTestId("ground-canvas")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Read-only." })).toBeVisible();

    await armFill(page);
    const hole = await holeOnScreen(page);
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    states[job.id as string] = taskState({ id: job.id, status: "COMPLETED" });
    running.length = 0;
    await expect(page.getByRole("status").filter({ hasText: "Read-only." })).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(() => writes.filter((write) => write.method === "PUT" && write.path === editsPath))
      .toHaveLength(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("says why it cannot open a map with no 3D map, and shows a refused save", async ({
    page,
  }) => {
    await mockBackend(page, { maps: [mapSummary()] });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await expect(page.getByText("This map has no 3D map to edit.")).toBeVisible();

    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.route(/\/api\/v1\/maps\/[^/]+\/octomap\/edits$/, (route, request) =>
      request.method() === "PUT"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              detail: "The robot is running a job on this map.",
              code: "task_running",
            }),
          })
        : route.fallback(),
    );
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await armFill(page);
    const hole = await holeOnScreen(page);
    await page.mouse.click(hole.x, hole.y);
    await page.getByRole("button", { name: "Save" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "running a job" });
    await expect(alert).toHaveText("Not saved. The robot is running a job on this map.");
    // Still unsaved, so the retry is a press away.
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("warns about a saved patch that lies outside this map's 3D map", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomapEdits: { [MAP_NAME]: [[O + 1, O + 1, O - 5], [O + 400, O + 400, O - 5]] },
    });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await expect(patched(page)).toHaveAttribute("data-patched", "1");
    await expect(
      page.getByRole("status").filter({ hasText: "1 saved patch lies outside" }),
    ).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("turns the map with the right button mid-edit, and paints only with the left", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    const canvas = page.getByTestId("ground-canvas");
    await expect(canvas).toHaveAttribute("data-distance", /\d+/);
    const opening = await canvas.getAttribute("data-distance");
    await armFill(page);

    // A right-drag across the hole orbits; it paints nothing.
    const hole = await holeOnScreen(page);
    await page.mouse.move(hole.x, hole.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(hole.x + 120, hole.y - 60, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await expect(patched(page)).toHaveAttribute("data-patched", "0");

    // Fit puts the camera back where it opened, and the hole under the middle.
    await page.getByRole("button", { name: "Fit to view" }).click();
    await expect(canvas).toHaveAttribute("data-distance", opening!);
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    // The wheel zooms, with the brush still armed.
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Number(await canvas.getAttribute("data-distance"))).toBeLessThan(
      Number(opening),
    );
    await expect(patched(page)).toHaveAttribute("data-patched", "4");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("asks before leaving with unsaved patches", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto(`/maps/${MAP_NAME}/ground`);
    await armFill(page);
    const hole = await holeOnScreen(page);
    await page.mouse.click(hole.x, hole.y);
    await expect(patched(page)).toHaveAttribute("data-patched", "4");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Back to maps" }).click();
    await expect(page.getByTestId("ground-canvas")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Back to maps" }).click();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test.describe("on a map that spans storeys", () => {
    /** The doormat's floor, and the same again a storey up (5.05 m). */
    function twoStoreys(): Buffer {
      const occupied: Array<[number, number, number]> = [];
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          occupied.push([O + x, O + y, O - 5], [O + x, O + y, O + 50]);
        }
      }
      return Buffer.from(encodeOctomapBt({ res: 0.1, occupied }));
    }

    const lowest = (page: Page) => page.getByRole("slider", { name: "Lowest height shown" });
    const highest = (page: Page) => page.getByRole("slider", { name: "Highest height shown" });

    test("narrows the heights to the floor picked, and a hand-set band to none", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, {
        maps: [mapSummary(withOctomap())],
        octomap: twoStoreys(),
        floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
      });
      await page.goto(`/maps/${MAP_NAME}/ground`);
      await expect(page.getByTestId("ground-canvas")).toBeVisible();
      const floors = page.getByRole("group", { name: "Floor" });
      await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // 2F starts a metre under its level (5.5 m): the slab's top is in it.
      await floors.getByRole("button", { name: "2F" }).click();
      await expect(lowest(page)).toHaveValue("4.55");
      await expect(highest(page)).toHaveValue("5.05");
      await floors.getByRole("button", { name: "1F" }).click();
      await expect(lowest(page)).toHaveValue("-0.45");
      await expect(highest(page)).toHaveValue("4.45");

      // A slider moved by hand is no floor's band.
      await highest(page).fill("3.05");
      for (const name of ["All", "1F", "2F"]) {
        await expect(floors.getByRole("button", { name })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      }
      expect(errors, "the page logged errors").toEqual([]);
    });
  });
});
