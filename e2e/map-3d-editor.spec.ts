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
  vertex,
  withOctomap,
  withoutOctomap,
} from "./backend";

/**
 * The map editor: the fake's doormat-sized 3D map is a 4×4 floor with a 2×2
 * hole in the middle (see octomapBt in backend.ts), half a metre under the
 * origin; the ground patches painted into it, and the map's waypoints and
 * forbidden zones on it. Every test
 * that writes asserts what the console sent, not only what the screen says —
 * the patch record is what the robot's tool applies, so a screen that says
 * "4 cells" over a PUT of the wrong keys would pass a screen-only test.
 */

const EDITOR = `/maps/${MAP_NAME}/edit`;
const drawList = (page: Page) => page.getByRole("combobox", { name: "Draw" });

/** Pick what a press works on in the 3D view's Draw list. */
async function chooseDraw(
  page: Page,
  kind: "Ground patch" | "Waypoint" | "Forbidden zone" | "No type",
) {
  await drawList(page).click();
  await page.getByRole("option", { name: kind, exact: true }).click();
}

/**
 * The middle of the canvas. The page opens looking at the middle of the map
 * on the floor shown (frameGround), so the ray through the canvas's centre
 * meets the map at its centre.
 */
async function centreOnScreen(page: Page) {
  const box = (await page.getByTestId("map-3d-canvas").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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

/** The fake's hole sits under the middle of the map: see centreOnScreen. */
const holeOnScreen = centreOnScreen;

async function armFill(page: Page, radius = "0.1 m") {
  await chooseDraw(page, "Ground patch");
  await page.getByRole("button", { name: "Fill" }).click();
  await page.getByRole("combobox", { name: "Brush radius" }).click();
  await page.getByRole("option", { name: radius, exact: true }).click();
}

const patched = (page: Page) => page.locator("[data-patched]");

test.describe("the editor's 3D view", () => {
  test("says why it cannot open a map with no 3D map", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withoutOctomap())] });
    await page.goto(EDITOR);
    await expect(page.getByText("This map has no 3D map, so there is nothing to edit.")).toBeVisible();
    await expect(page.getByTestId("map-3d-canvas")).toHaveCount(0);
    // Back still leads out.
    await page.getByRole("button", { name: "Back to maps" }).click();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("turns the map with the right button while placing, and places only with the left", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { maps: [mapSummary(withOctomap())], vertices: [] });
    await page.goto(EDITOR);
    const canvas = page.getByTestId("map-3d-canvas");
    await expect(canvas).toHaveAttribute("data-distance", /\d+/);
    const opening = await canvas.getAttribute("data-distance");
    await chooseDraw(page, "Waypoint");
    const tool = page.getByRole("button", { name: "Place" });
    await tool.click();
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });

    // A right-drag across the map orbits; it places nothing.
    const centre = await centreOnScreen(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(centre.x + 120, centre.y - 60, { steps: 8 });
    await page.mouse.up({ button: "right" });
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    await expect(dialog).toHaveCount(0);

    // Fit puts the camera back where it opened. The wheel zooms, with
    // Waypoint still armed — over the map, not the toolbar Fit left it on.
    await page.getByRole("button", { name: "Fit to view" }).click();
    await expect(canvas).toHaveAttribute("data-distance", opening!);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(async () => Number(await canvas.getAttribute("data-distance"))).toBeLessThan(
      Number(opening),
    );
    await expect(dialog).toHaveCount(0);

    // Positive control: the left button does place.
    await page.mouse.click(centre.x, centre.y);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(writes.filter((w) => w.path.endsWith("/vertices"))).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test.describe("ground patches", () => {
    test("fills the hole at the floor's height, and saves exactly those columns", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page, { maps: [mapSummary(withOctomap())] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
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

      const save = page.getByRole("button", { name: "Save", exact: true });
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
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      // The saved record is what it opens on, and is not unsaved.
      await expect(patched(page)).toHaveAttribute("data-patched", "4");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

      await chooseDraw(page, "Ground patch");
      await page.getByRole("button", { name: "Erase" }).click();
      const hole = await holeOnScreen(page);
      await page.mouse.click(hole.x, hole.y);
      await expect(patched(page)).toHaveAttribute("data-patched", "0");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

      await page.getByRole("button", { name: "Undo" }).click();
      await expect(patched(page)).toHaveAttribute("data-patched", "4");
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Redo" }).click();
      await expect(patched(page)).toHaveAttribute("data-patched", "0");

      await page.getByRole("button", { name: "Save", exact: true }).click();
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
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Read-only." })).toBeVisible();

      await armFill(page);
      const hole = await holeOnScreen(page);
      await page.mouse.click(hole.x, hole.y);
      await expect(patched(page)).toHaveAttribute("data-patched", "4");
      const save = page.getByRole("button", { name: "Save", exact: true });
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

    test("shows a refused save, and keeps the patches unsaved", async ({ page }) => {
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
      await page.goto(EDITOR);
      await armFill(page);
      const hole = await holeOnScreen(page);
      await page.mouse.click(hole.x, hole.y);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      const alert = page.getByRole("alert").filter({ hasText: "running a job" });
      await expect(alert).toHaveText("Not saved. The robot is running a job on this map.");
      // Still unsaved, so the retry is a press away.
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    });

    test("warns about a saved patch that lies outside this map's 3D map", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, {
        maps: [mapSummary(withOctomap())],
        octomapEdits: { [MAP_NAME]: [[O + 1, O + 1, O - 5], [O + 400, O + 400, O - 5]] },
      });
      await page.goto(EDITOR);
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
      await page.goto(EDITOR);
      const canvas = page.getByTestId("map-3d-canvas");
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
      await page.goto(EDITOR);
      await armFill(page);
      const hole = await holeOnScreen(page);
      await page.mouse.click(hole.x, hole.y);
      await expect(patched(page)).toHaveAttribute("data-patched", "4");

      page.once("dialog", (dialog) => dialog.dismiss());
      await page.getByRole("button", { name: "Back to maps" }).click();
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Back to maps" }).click();
      await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
      expect(errors, "the page logged errors").toEqual([]);
    });
  });

  test.describe("on a map that spans storeys", () => {
    /** The doormat's floor, and the same again a storey up (5.05 m). */
    function twoStoreys(): Buffer {
      const O = OCTREE_KEY_ORIGIN;
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
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      const floors = page.getByRole("group", { name: "Floor" });
      await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Under the Draw strip, not beside the toolbar.
      const draw = (await drawList(page).boundingBox())!;
      const column = (await floors.boundingBox())!;
      expect(column.y).toBeGreaterThanOrEqual(draw.y + draw.height);

      // 2F starts a metre under its level (5.5 m): the slab's top is in it.
      await floors.getByRole("button", { name: "2F" }).click();
      await expect(lowest(page)).toHaveValue("4.55");
      await expect(highest(page)).toHaveValue("5.05");
      await floors.getByRole("button", { name: "1F" }).click();
      await expect(lowest(page)).toHaveValue("-0.45");
      // And ends 1.5 m over its level (-0.2 m), under the ceiling.
      await expect(highest(page)).toHaveValue("1.25");

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

  test.describe("forbidden zones", () => {
    const keepoutPath = `/api/v1/maps/${MAP_NAME}/keepout`;
    const saveButton = (page: Page) => page.getByRole("button", { name: "Save", exact: true });
    const keepoutPut = (page: Page) =>
      page.waitForRequest(
        (request) => request.method() === "PUT" && new URL(request.url()).pathname === keepoutPath,
      );

    /** The doormat's floor, and the same again a storey up (top face 5.1 m). */
    function twoStoreys(): Buffer {
      const occupied: Array<[number, number, number]> = [];
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          occupied.push([O + x, O + y, O - 5], [O + x, O + y, O + 50]);
        }
      }
      return Buffer.from(encodeOctomapBt({ res: 0.1, occupied }));
    }

    /** Three corners round the canvas's centre, inside the doormat. */
    async function threeCorners(page: Page) {
      const box = (await page.getByTestId("map-3d-canvas").boundingBox())!;
      const { x, y } = await centreOnScreen(page);
      const d = Math.min(box.width, box.height) * 0.08;
      const corners = [
        { x: x - d, y: y - d },
        { x: x + d, y: y - d },
        { x: x + d, y: y + d },
      ];
      for (const corner of corners) await page.mouse.click(corner.x, corner.y);
      return corners;
    }

    test("forbids every floor on a map of one, closing on the first corner", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, { maps: [mapSummary(withOctomap())] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Forbidden zone");
      await expect(page.getByText("A new zone forbids every floor.")).toBeVisible();
      await page.getByRole("button", { name: "Shape" }).click();

      const puts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "PUT" && new URL(request.url()).pathname === keepoutPath) {
          puts.push(request.url());
        }
      });
      const corners = await threeCorners(page);
      await expect(page.getByText("3 corners")).toBeVisible();
      await page.mouse.click(corners[0].x, corners[0].y);
      // Closed on screen only: nothing goes to the robot until Save, which
      // lights up.
      await expect(page.getByText(/Unsaved — press Save/)).toBeVisible();
      await expect(saveButton(page)).toBeEnabled();
      expect(puts).toEqual([]);
      const put = keepoutPut(page);
      await saveButton(page).click();
      const body = (await put).postDataJSON() as { zones: Record<string, unknown>[] };

      expect(body.zones).toHaveLength(1);
      expect(body.zones[0].points).toHaveLength(3);
      // No band: every floor.
      expect(body.zones[0].z_min).toBeNull();
      expect(body.zones[0].z_max).toBeNull();
      // Saved: the reminder goes and Save greys again.
      await expect(page.getByText(/Unsaved — press Save/)).toHaveCount(0);
      await expect(saveButton(page)).toBeDisabled();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("forbids the floor picked only, on a map that spans storeys", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, {
        maps: [mapSummary(withOctomap())],
        octomap: twoStoreys(),
        floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
      });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await page.getByRole("group", { name: "Floor" }).getByRole("button", { name: "2F" }).click();
      // Look at 2F, so the taps land on its ground.
      await page.getByRole("button", { name: "Fit to view" }).click();
      await chooseDraw(page, "Forbidden zone");
      await expect(page.getByText(/A new zone forbids 2F only \(ground 5\.1 m\)/)).toBeVisible();
      await page.getByRole("button", { name: "Shape" }).click();

      await threeCorners(page);
      await page.keyboard.press("Enter");
      const put = keepoutPut(page);
      await saveButton(page).click();
      const body = (await put).postDataJSON() as { zones: Record<string, number>[] };

      // Half a storey either side of 2F's ground: the robot's 3D planner
      // keeps 2F out of it and leaves 1F under it alone.
      expect(body.zones[0].z_min).toBeCloseTo(4.6, 5);
      expect(body.zones[0].z_max).toBeCloseTo(5.6, 5);
      expect(errors, "the page logged errors").toEqual([]);
    });

    /** A square of four corners round the canvas's centre, closed: the map's first zone. */
    async function drawSquare(page: Page) {
      const box = (await page.getByTestId("map-3d-canvas").boundingBox())!;
      const { x, y } = await centreOnScreen(page);
      const d = Math.min(box.width, box.height) * 0.05;
      const square = {
        a: { x: x - d, y: y - d },
        b: { x: x + d, y: y - d },
        c: { x: x + d, y: y + d },
        e: { x: x - d, y: y + d },
      };
      for (const corner of [square.a, square.b, square.c, square.e]) {
        await page.mouse.click(corner.x, corner.y);
      }
      await page.mouse.click(square.a.x, square.a.y);
      const put = keepoutPut(page);
      await saveButton(page).click();
      const saved = (await put).postDataJSON() as {
        zones: { id: string; points: { x: number; y: number }[] }[];
      };
      await expect(saveButton(page)).toBeDisabled();
      return { ...square, d, saved: saved.zones[0].points };
    }

    test("grows a zone by a shape started on one of its corners and ended on another", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, { maps: [mapSummary(withOctomap())] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Forbidden zone");
      await page.getByRole("button", { name: "Shape" }).click();
      const square = await drawSquare(page);

      // Anchor on the zone's second corner, bulge out to the right, end on its third.
      await page.mouse.click(square.b.x, square.b.y);
      await expect(page.getByText(/joined to zone zone-1/)).toBeVisible();
      await page.mouse.click(square.b.x + square.d * 0.8, (square.b.y + square.c.y) / 2);
      await page.mouse.click(square.c.x, square.c.y);
      // Merged on screen; Save sends it.
      await expect(page.getByText(/joined to zone/)).toHaveCount(0);
      await expect(saveButton(page)).toBeEnabled();
      const put = keepoutPut(page);
      await saveButton(page).click();
      const body = (await put).postDataJSON() as {
        zones: { id: string; points: { x: number; y: number }[] }[];
      };

      // Still one zone, under its own id, with the new corner in it.
      expect(body.zones).toHaveLength(1);
      expect(body.zones[0].id).toBe("zone-1");
      expect(body.zones[0].points).toHaveLength(5);
      await expect(page.getByText(/joined to zone/)).toHaveCount(0);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("moves a finished zone's corner by dragging it", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, { maps: [mapSummary(withOctomap())] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Forbidden zone");
      await page.getByRole("button", { name: "Shape" }).click();
      const square = await drawSquare(page);

      await page.mouse.move(square.a.x, square.a.y);
      await page.mouse.down();
      await page.mouse.move(square.a.x - square.d * 0.6, square.a.y - square.d * 0.6, { steps: 5 });
      await page.mouse.up();
      // Moved on screen; Save sends it.
      await expect(saveButton(page)).toBeEnabled();
      const put = keepoutPut(page);
      await saveButton(page).click();
      const body = (await put).postDataJSON() as {
        zones: { id: string; points: { x: number; y: number }[] }[];
      };

      expect(body.zones).toHaveLength(1);
      expect(body.zones[0].id).toBe("zone-1");
      expect(body.zones[0].points).toHaveLength(4);
      // The dragged corner moved; the other three stayed where they were drawn.
      const [moved, ...rest] = body.zones[0].points;
      expect(moved).not.toEqual(square.saved[0]);
      expect(rest).toEqual(square.saved.slice(1));
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("removes a tapped zone after asking, keeping the others' bands", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const square = (half: number) => [
        { x: 0.2 - half, y: 0.2 - half },
        { x: 0.2 + half, y: 0.2 - half },
        { x: 0.2 + half, y: 0.2 + half },
        { x: 0.2 - half, y: 0.2 + half },
      ];
      await mockBackend(page, {
        maps: [mapSummary(withOctomap())],
        keepout: {
          [MAP_NAME]: [
            { id: "middle", points: square(0.1), name: null, z_min: null, z_max: null },
            // Off to the side, and another floor's: it must go back unchanged.
            {
              id: "upstairs",
              points: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }],
              name: "rack",
              z_min: 4.6,
              z_max: 5.6,
            },
          ],
        },
      });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Forbidden zone");
      await page.getByRole("button", { name: "Remove zone" }).click();

      page.once("dialog", (dialog) => void dialog.accept());
      const put = keepoutPut(page);
      const centre = await centreOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      const body = (await put).postDataJSON() as { zones: Record<string, unknown>[] };

      expect(body.zones).toEqual([
        {
          id: "upstairs",
          points: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }],
          name: "rack",
          z_min: 4.6,
          z_max: 5.6,
        },
      ]);
      expect(errors, "the page logged errors").toEqual([]);
    });
  });

  test.describe("waypoints", () => {
    const verticesPath = `/api/v1/maps/${MAP_NAME}/vertices`;
    /** A map with its 3D map built, not the one the robot runs. */
    const treeOnly = (over: Record<string, unknown> = {}) =>
      mapSummary({ active: false, ...over });

    /** Press, drag and release at the canvas's centre: a placement with Waypoint armed. */
    async function pressAndAim(page: Page) {
      const centre = await centreOnScreen(page);
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 40, centre.y, { steps: 4 });
      await page.mouse.up();
    }

    test("is reached from the card's pencil, opening on Orbit", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, {
        maps: [
          treeOnly(),
          // No 3D map: nothing for the pencil to open.
          mapSummary({ name: "bare", active: false, ...withoutOctomap() }),
        ],
        vertices: [],
      });
      await page.goto("/maps");
      await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();

      await expect(page.getByRole("link", { name: "Edit bare" })).toHaveCount(0);
      const pencil = page.getByRole("link", { name: `Edit ${MAP_NAME}` });
      await expect(pencil).toHaveAttribute("href", EDITOR);
      await pencil.click();
      await expect(page).toHaveURL(new RegExp(`/maps/${MAP_NAME}/edit$`));
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      // An editor opened to look round opens on Orbit:
      // only a link that came to place waypoints arms the tool.
      await expect(page.getByRole("button", { name: "Orbit" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Nothing chosen to work on, so no waypoint tool is offered yet.
      await expect(drawList(page)).toContainText("No type");
      await expect(page.getByRole("button", { name: "Place" })).toHaveCount(0);

      await page.getByRole("button", { name: "Back to maps" }).click();
      await expect(page).toHaveURL(/\/maps$/);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("holds Waypoint unarmed while a job drives on the map, and arms it once the job ends", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const job = activeTask();
      const activeTasks = [job];
      // Given its ending before it leaves the list: the masthead reads it
      // once more after, and a 404 would be a console error.
      const states: Record<string, Record<string, unknown>> = {};
      await mockBackend(page, {
        maps: [treeOnly()],
        vertices: [],
        activeTasks,
        taskStates: states,
      });
      await page.goto(`${EDITOR}?tool=waypoint`);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      const tool = page.getByRole("button", { name: "Place" });
      await expect(page.getByRole("status").filter({ hasText: "Read-only." })).toBeVisible();
      await expect(tool).toBeDisabled();
      await expect(tool).toHaveAttribute("aria-pressed", "false");

      // The job leaves the list; the next poll clears the lock, and the
      // link's ask, held until then, arms the tool.
      states[job.id as string] = taskState({ id: job.id, status: "COMPLETED" });
      activeTasks.length = 0;
      await expect(tool).toHaveAttribute("aria-pressed", "true");
      await expect(tool).toBeEnabled();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("is reached from the task editor, and Back returns there", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, { maps: [treeOnly({ active: true })], vertices: [] });
      await page.goto("/tasks/editor");
      await page.getByRole("button", { name: "Add a Move stop" }).click();

      const href = `${EDITOR}?tool=waypoint&from=tasks`;
      // The stop's hint names the 3D map, which is where they go on this map.
      const hint = page.getByRole("region", { name: "Stops" }).getByText(/has no waypoints yet/);
      await expect(hint).toContainText("place some on the 3D map first.");
      await expect(hint.getByRole("link", { name: "place some" })).toHaveAttribute("href", href);

      await page.getByRole("link", { name: "Add waypoints on the 3D map" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/maps/${MAP_NAME}/edit\\?tool=waypoint&from=tasks$`),
      );
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await expect(drawList(page)).toContainText("Waypoint");
      await expect(page.getByRole("button", { name: "Place" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // Armed for real, not only drawn pressed: the first press asks for a
      // name with no click on the tool before it.
      await pressAndAim(page);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("button", { name: "Back to tasks" }).click();
      await expect(page).toHaveURL(/\/tasks\/editor$/);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("stays in the 3D view across a rename", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const map = treeOnly();
      await mockBackend(page, { maps: [map], vertices: [] });
      // The fake has no map rename; this one renames its catalogue entry too.
      let sent: unknown = null;
      await page.route(new RegExp(`/api/v1/maps/${MAP_NAME}$`), async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        sent = route.request().postDataJSON();
        map.name = "dp3f";
        await route.fulfill({
          json: {
            old_name: MAP_NAME,
            name: "dp3f",
            vertices_moved: 0,
            templates_moved: 0,
            message: `Renamed '${MAP_NAME}' to 'dp3f'.`,
          },
        });
      });
      await page.goto(`${EDITOR}?tool=waypoint`);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      await page.getByRole("heading", { name: new RegExp(`^${MAP_NAME} — `) }).dblclick();
      const input = page.getByRole("textbox", { name: "New map name" });
      await input.fill("dp3f");
      await input.press("Enter");

      // The query rides along, so Waypoint stays armed.
      await expect(page).toHaveURL(/\/maps\/dp3f\/edit\?tool=waypoint$/);
      expect(sent).toEqual({ name: "dp3f" });
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("places a run of stops, and sends them all on Save, at the ground floor's 0", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      // Positive control: with no tool armed a press only turns the map.
      const centre = await centreOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await expect(dialog).toHaveCount(0);

      await chooseDraw(page, "Waypoint");
      const tool = page.getByRole("button", { name: "Place" });
      await tool.click();
      await expect(tool).toHaveAttribute("aria-pressed", "true");

      for (const stopName of ["lobby", "lift"]) {
        await pressAndAim(page);
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("Name").fill(stopName);
        await dialog.getByRole("button", { name: "Create" }).click();
        await expect(dialog).toHaveCount(0);
        // Still armed for the next stop: a run is placed without re-arming.
        await expect(tool).toHaveAttribute("aria-pressed", "true");
      }

      // Nothing has left the console: Create only staged them.
      expect(writes.filter((w) => w.path.startsWith(verticesPath))).toEqual([]);
      await expect(page.getByText("Unsaved: 2 added")).toBeVisible();

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => writes.filter((w) => w.path === verticesPath)).toHaveLength(1);
      const write = writes.find((w) => w.path === verticesPath)!;
      expect(write.method).toBe("POST");
      const body = write.body as {
        name: string;
        x: number;
        y: number;
        theta: number;
        z: number;
      }[];
      // One batch, in the order placed.
      expect(body.map((stop) => stop.name)).toEqual(["lobby", "lift"]);
      for (const stop of body) {
        // On the 3D map's box (0..0.4 m each way), not wherever the ray went.
        for (const value of [stop.x, stop.y]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(0.4);
        }
        expect(Number.isFinite(stop.theta)).toBe(true);
        // No floors on this map, so the ground under the stop -- but the
        // press lands on octomapBt's hole, where there is none to read: the
        // wire's 0. (A stop over ground: waypoint-ground.test.ts.)
        expect(stop.z).toBe(0);
      }
      await expect(
        page.getByRole("status").filter({ hasText: "Waypoints saved: 2 added" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("asks before leaving with unsaved waypoints", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page, { maps: [treeOnly()], vertices: [] });
      await page.goto(`${EDITOR}?tool=waypoint`);
      await expect(page.getByRole("button", { name: "Place" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await pressAndAim(page);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await dialog.getByLabel("Name").fill("lobby");
      await dialog.getByRole("button", { name: "Create" }).click();

      page.once("dialog", (confirm) => void confirm.dismiss());
      await page.getByRole("button", { name: "Back to maps" }).click();
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("opens a stop on a tap, offers no Move, and deletes it on Save", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const stop = vertex({ name: "lobby", type: "MOVE", x: 0.2, y: 0.2, theta: 0, z: 0 });
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [stop] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      const centre = await centreOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      const dialog = page.getByRole("alertdialog", { name: "lobby" });
      await expect(dialog).toBeVisible();
      // An editor, on a map the robot may not be on: nowhere to send it from.
      await expect(dialog.getByRole("button", { name: "Move" })).toHaveCount(0);

      const asked: string[] = [];
      page.once("dialog", (confirm) => {
        asked.push(confirm.message());
        void confirm.accept();
      });
      await dialog.getByRole("button", { name: "Delete" }).click();
      await expect(dialog).toHaveCount(0);
      expect(asked).toEqual([`Delete "lobby"? It is removed from the robot when you save.`]);
      // Gone from the screen, not yet from the robot.
      expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => writes.filter((w) => w.method === "DELETE").map((w) => w.path))
        .toEqual([`${verticesPath}/${stop.id}`]);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("removes a tapped stop with Remove once the confirm is accepted, and deletes it on Save", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const stop = vertex({ name: "lobby", type: "MOVE", x: 0.2, y: 0.2, theta: 0, z: 0 });
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [stop] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Waypoint");
      const remove = page.getByRole("button", { name: "Remove" });
      await remove.click();
      await expect(remove).toHaveAttribute("aria-pressed", "true");
      const centre = await centreOnScreen(page);

      // Declined: the stop stays, and its dialog does not open either.
      const asked: string[] = [];
      page.once("dialog", (confirm) => {
        asked.push(confirm.message());
        void confirm.dismiss();
      });
      await page.mouse.click(centre.x, centre.y);
      await expect
        .poll(() => asked)
        .toEqual([`Delete "lobby"? It is removed from the robot when you save.`]);
      await expect(page.getByRole("alertdialog", { name: "lobby" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

      // Accepted: the stop goes from the screen, and Remove stays armed.
      page.once("dialog", (confirm) => void confirm.accept());
      await page.mouse.click(centre.x, centre.y);
      await expect(page.getByText("Unsaved: 1 deleted")).toBeVisible();
      await expect(remove).toHaveAttribute("aria-pressed", "true");
      expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => writes.filter((w) => w.method === "DELETE").map((w) => w.path))
        .toEqual([`${verticesPath}/${stop.id}`]);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("drags a stop somewhere else with Move, keeping its heading, and sends it on Save", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const stop = vertex({ name: "lobby", type: "MOVE", x: 0.2, y: 0.2, theta: 45, z: 0 });
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [stop] });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();
      await chooseDraw(page, "Waypoint");
      const move = page.getByRole("button", { name: "Move", exact: true });
      await move.click();
      await expect(move).toHaveAttribute("aria-pressed", "true");
      const centre = await centreOnScreen(page);

      // Positive control: a tap with Move armed opens the stop, moves nothing.
      await page.mouse.click(centre.x, centre.y);
      const dialog = page.getByRole("alertdialog", { name: "lobby" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 40, centre.y + 20, { steps: 6 });
      await page.mouse.up();
      await expect(page.getByText("Unsaved: 1 moved")).toBeVisible();
      // Staged, not written.
      expect(writes.filter((w) => w.path.startsWith(verticesPath))).toEqual([]);

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => writes.filter((w) => w.method === "PUT").map((w) => w.path))
        .toEqual([`${verticesPath}/${stop.id}`]);
      const body = writes.find((w) => w.method === "PUT")!.body as Record<string, number>;
      // Somewhere else on the 3D map's box, its heading and floor untouched.
      expect(body.x !== 0.2 || body.y !== 0.2).toBe(true);
      for (const value of [body.x ?? 0.2, body.y ?? 0.2]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0.4);
      }
      expect(body).not.toHaveProperty("theta");
      expect(body).not.toHaveProperty("z");
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("lists every stop's name, and deletes a selection from the list and the map together on Save", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const stops = [
        vertex({ id: "a", name: "lobby", type: "MOVE", x: 0.2, y: 0.2, theta: 0, z: 0 }),
        vertex({ id: "b", name: "lift", type: "MOVE", x: 0.05, y: 0.05, theta: 0, z: 0 }),
        vertex({ id: "c", name: "dock-a", type: "CHARGE", x: 0.35, y: 0.05, theta: 0, z: 0 }),
      ];
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: stops });
      await page.goto(EDITOR);
      await expect(page.getByTestId("map-3d-canvas")).toBeVisible();

      // No list until Waypoint is chosen; then every name, for picking a new one.
      const list = page.getByRole("button", { name: /lobby|lift|dock-a/ });
      await expect(list).toHaveCount(0);
      await chooseDraw(page, "Waypoint");
      await expect(list).toHaveCount(3);

      // One from the list, one tapped on the map with Select.
      await page.getByRole("button", { name: /lift/ }).click();
      await expect(page.getByRole("button", { name: /lift/ })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Select", exact: true }).click();
      const centre = await centreOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      await expect(page.getByRole("button", { name: /lobby/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("2 selected")).toBeVisible();

      // Declined: nothing goes.
      const asked: string[] = [];
      page.once("dialog", (confirm) => {
        asked.push(confirm.message());
        void confirm.dismiss();
      });
      await page.getByRole("button", { name: "Delete 2" }).click();
      await expect
        .poll(() => asked)
        .toEqual(["Delete 2 waypoints? They are removed from the robot when you save."]);
      await expect(list).toHaveCount(3);

      page.once("dialog", (confirm) => void confirm.accept());
      await page.getByRole("button", { name: "Delete 2" }).click();
      await expect(page.getByText("Unsaved: 2 deleted")).toBeVisible();
      await expect(list).toHaveCount(1);
      await expect(page.getByRole("button", { name: /dock-a/ })).toBeVisible();
      expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(() => writes.filter((w) => w.method === "DELETE").map((w) => w.path).sort())
        .toEqual([`${verticesPath}/a`, `${verticesPath}/b`]);
      expect(errors, "the page logged errors").toEqual([]);
    });
  });
});
