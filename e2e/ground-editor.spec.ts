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

    await expect(page.getByRole("link", { name: "Open the 3D map of flat" })).toHaveCount(0);
    const link = page.getByRole("link", { name: "Open the 3D map of solid" });
    await expect(link).toHaveAttribute("href", "/maps/solid/3d");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("fills the hole at the floor's height, and saves exactly those columns", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
    await page.goto(`/maps/${MAP_NAME}/3d`);
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
      await page.goto(`/maps/${MAP_NAME}/3d`);
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

  test.describe("waypoints on a map with no floor plan", () => {
    const verticesPath = `/api/v1/maps/${MAP_NAME}/vertices`;
    /** A map the floor plan editor cannot open: a 3D map and no raster. */
    const treeOnly = (over: Record<string, unknown> = {}) =>
      mapSummary({
        active: false,
        grid: null,
        thumbnail: null,
        grid_status: "none",
        ...withOctomap(),
        ...over,
      });

    /** Press, drag and release at the canvas's centre: a placement with Waypoint armed. */
    async function pressAndAim(page: Page) {
      const centre = await holeOnScreen(page);
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 40, centre.y, { steps: 4 });
      await page.mouse.up();
    }

    test("is reached from the card's pencil, with Waypoint armed", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page, {
        maps: [
          treeOnly(),
          // Neither a floor plan nor a 3D map: nothing for the pencil to open.
          mapSummary({
            name: "bare",
            active: false,
            grid: null,
            thumbnail: null,
            grid_status: "none",
          }),
        ],
        vertices: [],
      });
      await page.goto("/maps");
      await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();

      await expect(page.getByRole("link", { name: /^Edit (the waypoints of )?bare$/ })).toHaveCount(0);
      const pencil = page.getByRole("link", { name: `Edit the waypoints of ${MAP_NAME}` });
      // Not the floor plan editor, which has no raster to open here.
      await expect(pencil).toHaveAttribute("href", `/maps/${MAP_NAME}/3d?tool=waypoint`);
      await pencil.click();
      await expect(page).toHaveURL(new RegExp(`/maps/${MAP_NAME}/3d\\?tool=waypoint$`));
      await expect(page.getByTestId("ground-canvas")).toBeVisible();

      const tool = page.getByRole("button", { name: "Waypoint" });
      await expect(tool).toHaveAttribute("aria-pressed", "true");
      // Armed for real, not only drawn pressed: the first press asks for a
      // name with no click on the tool before it.
      await pressAndAim(page);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(writes.filter((w) => w.path.endsWith("/vertices"))).toEqual([]);

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
      // Given its ending before it leaves the list, as in "holds Save while a
      // job drives on the map": the masthead reads it once more after.
      const states: Record<string, Record<string, unknown>> = {};
      await mockBackend(page, {
        maps: [treeOnly()],
        vertices: [],
        activeTasks,
        taskStates: states,
      });
      await page.goto(`/maps/${MAP_NAME}/3d?tool=waypoint`);
      await expect(page.getByTestId("ground-canvas")).toBeVisible();

      const tool = page.getByRole("button", { name: "Waypoint" });
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
      await page.getByTitle("Drive to a pose in the map frame.").click();

      const href = `/maps/${MAP_NAME}/3d?tool=waypoint&from=tasks`;
      // The row's hint names the 3D map, which is where they go on this map.
      const hint = page.getByText(/has no waypoints yet/);
      await expect(hint).toContainText("place some on the 3D map first.");
      await expect(hint.getByRole("link", { name: "place some" })).toHaveAttribute("href", href);

      await page.getByRole("link", { name: "Add waypoints on the 3D map" }).click();
      await expect(page).toHaveURL(new RegExp(`/maps/${MAP_NAME}/3d\\?tool=waypoint&from=tasks$`));
      await expect(page.getByTestId("ground-canvas")).toBeVisible();
      await expect(page.getByRole("button", { name: "Waypoint" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page.getByRole("button", { name: "Back to tasks" }).click();
      await expect(page).toHaveURL(/\/tasks\/editor$/);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("stays on the 3D map page across a rename", async ({ page }) => {
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
      await page.goto(`/maps/${MAP_NAME}/3d?tool=waypoint`);
      await expect(page.getByTestId("ground-canvas")).toBeVisible();

      await page.getByRole("heading", { name: new RegExp(`^${MAP_NAME} — `) }).dblclick();
      const input = page.getByRole("textbox", { name: "New map name" });
      await input.fill("dp3f");
      await input.press("Enter");

      // Not the floor plan editor, which this map has no floor plan for.
      await expect(page).toHaveURL(/\/maps\/dp3f\/3d\?tool=waypoint$/);
      expect(sent).toEqual({ name: "dp3f" });
      await expect(page.getByTestId("ground-canvas")).toBeVisible();
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("places one with a press and a drag, and posts it at the ground floor's 0", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [] });
      await page.goto(`/maps/${MAP_NAME}/3d`);
      await expect(page.getByTestId("ground-canvas")).toBeVisible();

      // Positive control: with no tool armed a press only turns the map.
      const centre = await holeOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await expect(dialog).toHaveCount(0);

      const tool = page.getByRole("button", { name: "Waypoint" });
      await tool.click();
      await expect(tool).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + 40, centre.y, { steps: 4 });
      await page.mouse.up();

      await expect(dialog).toBeVisible();
      // The release only asks the question.
      expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);
      await dialog.getByLabel("Name").fill("lobby");
      await dialog.getByRole("button", { name: "Create" }).click();

      await expect.poll(() => writes.filter((w) => w.path === verticesPath)).toHaveLength(1);
      const write = writes.find((w) => w.path === verticesPath)!;
      expect(write.method).toBe("POST");
      const [body] = write.body as {
        name: string;
        x: number;
        y: number;
        theta: number;
        z: number;
      }[];
      expect(body.name).toBe("lobby");
      // On the 3D map's box (0..0.4 m each way), not wherever the ray went.
      for (const value of [body.x, body.y]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0.4);
      }
      expect(Number.isFinite(body.theta)).toBe(true);
      // No floors on this map: the ground floor, the wire's 0.
      expect(body.z).toBe(0);

      await expect(dialog).toHaveCount(0);
      // Single-shot: the tool disarmed on release.
      await expect(tool).toHaveAttribute("aria-pressed", "false");
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("opens a stop on a tap, offers no Move, and deletes it", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const stop = vertex({ name: "lobby", type: "MOVE", x: 0.2, y: 0.2, theta: 0, z: 0 });
      const writes = await mockBackend(page, { maps: [treeOnly()], vertices: [stop] });
      await page.goto(`/maps/${MAP_NAME}/3d`);
      await expect(page.getByTestId("ground-canvas")).toBeVisible();

      const centre = await holeOnScreen(page);
      await page.mouse.click(centre.x, centre.y);
      const dialog = page.getByRole("alertdialog", { name: "lobby" });
      await expect(dialog).toBeVisible();
      // An editor, on a map the robot may not be on: nowhere to send it from.
      await expect(dialog.getByRole("button", { name: "Move" })).toHaveCount(0);

      page.once("dialog", (confirm) => void confirm.accept());
      await dialog.getByRole("button", { name: "Delete" }).click();
      await expect(dialog).toHaveCount(0);
      const deleted = writes.find((w) => w.method === "DELETE");
      expect(deleted?.path).toBe(`${verticesPath}/${stop.id}`);
      expect(errors, "the page logged errors").toEqual([]);
    });
  });
});
