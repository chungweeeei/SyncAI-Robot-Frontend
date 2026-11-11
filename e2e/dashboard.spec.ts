import { expect, test, type Page } from "@playwright/test";

import { GROUND_FLOOR_Z_M, drawnGround } from "@/lib/map/floors";
import { encodeOctomapBt } from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

import {
  CHARGER_SIGHTING,
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  mapSummary,
  mockBackend,
  robotState,
  taskState,
  TWO_FLOORS,
  vertex,
  withOctomap,
  withoutOctomap,
} from "./backend";

/**
 * Two cells at the corners of a 20 × 15 m box centred on (-2.3, -0.3), at
 * key height `kz` (relative to the origin): what Recenter frames once the 3D
 * map is up, so a test can say where a stop lands on screen. 0.1 m cells.
 */
function framingCorners(kz: number): Array<[number, number, number]> {
  const O = OCTREE_KEY_ORIGIN;
  return [
    [O - 123, O - 78, O + kz],
    [O + 76, O + 71, O + kz],
  ];
}

/** The fake's doormat floor, inside the 20 × 15 m box Recenter frames. */
function framedTree(): Buffer {
  const O = OCTREE_KEY_ORIGIN;
  const occupied: Array<[number, number, number]> = [];
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) occupied.push([O + x, O + y, O - 5]);
  }
  occupied.push(...framingCorners(-5));
  return Buffer.from(encodeOctomapBt({ res: 0.1, occupied }));
}

/**
 * Where a map point lands on screen once Recenter has framed framingCorners'
 * 20 × 15 m box (centred on -2.3, -0.3): lib/scene/camera.ts's frameMap,
 * from the south span·0.6 back and span·0.8 up, looking at `viewZ`, through
 * the viewport's 60° lens. `z` is the height the point is drawn at.
 */
async function recenteredOnScreen(
  page: Page,
  point: { x: number; y: number; z: number },
  viewZ = 0,
): Promise<{ x: number; y: number }> {
  const box = (await page.getByRole("region", { name: "Map viewport" }).boundingBox())!;
  const span = 20;
  const target = [-2.3, -0.3, viewZ];
  const eye = [target[0], target[1] - span * 0.6, viewZ + span * 0.8];
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const norm = (a: number[]) => a.map((v) => v / Math.hypot(...a));
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  // z-up, as every 3D view is.
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 0, 1]));
  const up = cross(right, forward);
  const d = sub([point.x, point.y, point.z], eye);
  const depth = dot(d, forward);
  const tanHalfFov = Math.tan(Math.PI / 6);
  const ndcX = dot(d, right) / (depth * tanHalfFov * (box.width / box.height));
  const ndcY = dot(d, up) / (depth * tanHalfFov);
  return {
    x: box.x + (box.width / 2) * (1 + ndcX),
    y: box.y + (box.height / 2) * (1 - ndcY),
  };
}

/**
 * The dashboard's 3D view: its layers, and the waypoints placed and tapped on it.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
test.describe("the dashboard's map scan layer", () => {
  const scanPath = `/api/v1/maps/${MAP_NAME}/pointcloud`;
  // The name carries " · loading" while the download is in flight.
  const toggle = (page: Page) =>
    page.getByRole("button", { name: /^Map scan/ });

  test("downloads the running map's scan once, and only when asked", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    const scanReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/pointcloud")) scanReads.push(pathname);
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    // Hundreds of thousands of points: a weak client pays for them only when
    // someone asks to see them.
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(scanReads).toEqual([]);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => scanReads).toEqual([scanPath]);

    // Off and on again is the same file, so it comes from the cache.
    await toggle(page).click();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(scanReads).toEqual([scanPath]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("is not offered for a map with no scan on disk", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary({ has_pointcloud: false })] });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Recenter" })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps the scan it has through a change to the map's directory", async ({
    page,
  }) => {
    // A save into the map moves the catalogue's modified_at but leaves the scan alone,
    // so a new directory time must not cost a second (large) download.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const entry = mapSummary();
    await mockBackend(page, { maps: [entry] });
    const scanReads: string[] = [];
    const catalogueReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/pointcloud")) scanReads.push(pathname);
      if (pathname === "/api/v1/maps") catalogueReads.push(pathname);
    });
    const visitMapsAndReturn = async () => {
      await page.getByRole("link", { name: "Maps" }).click();
      await expect(
        page.getByRole("heading", { name: "Maps", level: 1 }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Dashboard" }).click();
      await expect(
        page.getByRole("region", { name: "Map viewport" }),
      ).toBeVisible();
    };

    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();
    await expect(page.getByText("robot01").first()).toBeVisible();
    await toggle(page).click();
    await expect.poll(() => scanReads).toEqual([scanPath]);

    // Rebuilt elsewhere. The catalogue is read again and reports the new time,
    // so a scan keyed by that time would be fetched again here.
    entry.modified_at = "2026-09-28T08:00:00Z";
    const readsBefore = catalogueReads.length;
    await visitMapsAndReturn();
    await expect.poll(() => catalogueReads.length).toBeGreaterThan(readsBefore);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    // A cached scan draws with no download in flight; give a refetch time to
    // show up before saying there was none.
    await page.waitForTimeout(1500);
    expect(scanReads).toEqual([scanPath]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  // No console-error guard here: the browser logs the 404 itself, which is
  // exactly the response under test.
  test("says why the scan did not arrive, in the backend's words", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.route(/\/api\/v1\/maps\/[^/]+\/pointcloud$/, (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: `Map '${MAP_NAME}' has no saved scan` }),
      }),
    );
    await page.goto("/");

    await toggle(page).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "has no saved scan" });
    await expect(alert).toHaveText(`Map '${MAP_NAME}' has no saved scan`);

    // Turning the layer off is what dismisses it.
    await toggle(page).click();
    await expect(alert).toHaveCount(0);
  });
});

test.describe("the dashboard's 3D map layer", () => {
  const treePath = `/api/v1/maps/${MAP_NAME}/octomap`;
  const toggle = (page: Page) => page.getByRole("button", { name: /^3D map/ });

  test("downloads the running map's tree once, and draws it from the start", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    const treeReads: string[] = [];
    const patchReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/octomap")) treeReads.push(pathname);
      if (pathname.endsWith("/octomap/edits")) patchReads.push(pathname);
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    // The map the robot navigates on, so it is up without asking.
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => treeReads).toEqual([treePath]);
    // With the ground patches saved for it: the map as the robot drives it.
    await expect.poll(() => patchReads).toEqual([`${treePath}/edits`]);

    // Off and on is the same version, so it comes from the cache.
    await toggle(page).click();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    expect(treeReads).toEqual([treePath]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("is not offered for a map the robot built no 3D map for", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withoutOctomap())] });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Recenter" })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("shows one floor at a time of a map that spans storeys", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
    });
    const floorReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/floors")) floorReads.push(pathname);
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    const floors = page.getByRole("group", { name: "Floor" });
    await expect(floors).toBeVisible();
    // The floors are picked on the 3D map, so not offered while it is hidden.
    await toggle(page).click();
    await expect(floors).toHaveCount(0);
    await toggle(page).click();
    await expect(floors).toBeVisible();
    await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await floors.getByRole("button", { name: "2F" }).click();
    await expect(floors.getByRole("button", { name: "2F" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await floors.getByRole("button", { name: "All" }).click();
    await page.waitForTimeout(500);
    expect(floorReads).toEqual([`/api/v1/maps/${MAP_NAME}/floors`]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("draws a map of one storey under its ceiling, and All puts it back", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto("/");
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    const floors = page.getByRole("group", { name: "Floor" });
    await expect(floors).toBeVisible();
    // The one floor, cut under its ceiling, is what opens.
    await expect(floors.getByRole("button", { name: "1F" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // There is no other floor to follow the robot onto.
    await expect(floors.getByRole("button", { name: "Follow robot" })).toHaveCount(0);
    await floors.getByRole("button", { name: "All" }).click();
    await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(floors.getByRole("button", { name: "1F" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await floors.getByRole("button", { name: "1F" }).click();
    await expect(floors.getByRole("button", { name: "1F" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Picked on the 3D map, so not offered while it is hidden.
    await toggle(page).click();
    await expect(floors).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("frames on the 3D map, and holds the operator's choice to hide it", async ({ page }) => {
    // The tree is what the viewport has to frame, so Recenter looks at it.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary()] });
    const treeReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/octomap")) treeReads.push(pathname);
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => treeReads).toEqual([treePath]);
    await page.getByRole("button", { name: "Recenter" }).click();

    // Still the operator's to hide, and the choice holds.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(300);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    // Settled: the decode and the draw have had a frame to throw.
    await page.waitForTimeout(500);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("downloads the tree again once the catalogue reports a new version", async ({
    page,
  }) => {
    // The robot's edit tool replaces the file in place; modified_at cannot say
    // which file moved, so the version is what retires the cached decode.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const entry = mapSummary(withOctomap("1-1"));
    await mockBackend(page, { maps: [entry] });
    const treeReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/octomap")) treeReads.push(pathname);
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();
    await expect.poll(() => treeReads).toEqual([treePath]);

    entry.octomap_version = "2-2";
    await page.getByRole("link", { name: "Maps" }).click();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => treeReads).toEqual([treePath, treePath]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  // No console-error guard: the browser logs the 409 itself.
  test("says why the tree did not arrive, in the backend's words", async ({
    page,
  }) => {
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.route(/\/api\/v1\/maps\/[^/]+\/octomap$/, (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          detail: `The 3D map of '${MAP_NAME}' is still being built`,
          code: "octomap_converting",
        }),
      }),
    );
    await page.goto("/");

    const alert = page.getByRole("alert").filter({ hasText: "still being built" });
    await expect(alert).toHaveText(`The 3D map of '${MAP_NAME}' is still being built`);

    await toggle(page).click();
    await expect(alert).toHaveCount(0);
  });
});

test.describe("the dashboard's forbidden zone layer", () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: /^Forbidden zones/ });
  const zone = {
    id: "zone-1",
    points: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  };

  test("reads the running map's zones and draws them, on by default", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { keepout: { [MAP_NAME]: [zone] } });
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/keepout")) reads.push(pathname);
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    // The zones of the map the robot is on, not of whichever map was edited.
    await expect
      .poll(() => reads)
      .toEqual([`/api/v1/maps/${MAP_NAME}/keepout`]);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("is not offered for a map with no zones", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    // The positive control: the layer strip is up, with the stops' toggle.
    await expect(
      page.getByRole("button", { name: /^Waypoints/ }),
    ).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("adding a waypoint from the dashboard", () => {
  const verticesPath = `/api/v1/maps/${MAP_NAME}/vertices`;

  /**
   * Arm the tool and make the placing gesture on the viewport: a press near
   * the middle of the region (the opening view is centred on the map, so the
   * floor there is inside it), a drag to the right to aim it, a release.
   */
  const placeOnMap = async (page: Page, tool = "Add waypoint") => {
    const region = page.getByRole("region", { name: "Map viewport" });
    await expect(region).toBeVisible();
    const place = page.getByRole("button", { name: tool });
    await place.click();
    await expect(place).toHaveAttribute("aria-pressed", "true");
    const box = (await region.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();
  };

  test("asks for a name after the drag, and posts the placed pose with it", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    await page.goto("/");

    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await expect(dialog).toBeVisible();
    // Nothing has been written yet: the release only asks the question.
    expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);

    const create = dialog.getByRole("button", { name: "Create" });
    await expect(create).toBeDisabled();
    await dialog.getByLabel("Name").fill("shelf-b");
    await dialog.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: /^Charger/ }).click();
    await create.click();

    await expect
      .poll(() => writes.filter((w) => w.path === verticesPath))
      .toHaveLength(1);
    const write = writes.find((w) => w.path === verticesPath)!;
    expect(write.method).toBe("POST");
    const body = write.body as {
      name: string;
      type: string;
      x: number;
      y: number;
      theta: number;
    }[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("shelf-b");
    expect(body[0].type).toBe("CHARGE");
    expect(Number.isFinite(body[0].x)).toBe(true);
    expect(Number.isFinite(body[0].y)).toBe(true);
    // A drag to screen-right on the opening view aims along map +x.
    expect(Math.abs(body[0].theta)).toBeLessThan(30);

    // The echoed row closed the dialog: the create parsed and was spliced in.
    await expect(dialog).toHaveCount(0);
    // And the tool disarmed on release, so a stray click cannot place another.
    await expect(
      page.getByRole("button", { name: "Add waypoint" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("takes the robot's own position instead, and keeps the typed name", async ({
    page,
  }) => {
    // The stop you mark by driving to it: the fake's robot stands at
    // (1.25, -3.5, 90°) on the active map, and the button swaps the placed
    // pose for that one without throwing away the name already typed.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    await page.goto("/");

    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await dialog.getByLabel("Name").fill("where-it-stands");
    await dialog.getByRole("button", { name: "Use robot position" }).click();
    await expect(dialog.getByLabel("Name")).toHaveValue("where-it-stands");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === verticesPath))
      .toHaveLength(1);
    const body = writes.find((w) => w.path === verticesPath)!.body as {
      name: string;
      x: number;
      y: number;
      theta: number;
    }[];
    expect(body[0]).toMatchObject({
      name: "where-it-stands",
      x: 1.25,
      y: -3.5,
      theta: 90,
    });
    expect(errors, "the page logged errors").toEqual([]);
  });

  test.describe("detecting the charger", () => {
    const detectPath = "/api/v1/landmarks/detect";
    const detects = (writes: { path: string }[]) =>
      writes.filter((w) => w.path === detectPath);

    /** Place a stop, name it, and make it a Charger: where Detect charger is. */
    const placeCharger = async (page: Page, name: string) => {
      await placeOnMap(page);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("combobox", { name: "Type" }).click();
      await page.getByRole("option", { name: /^Charger/ }).click();
      return dialog;
    };

    test("takes the pose the robot measured, keeps the typed name, and posts it as a Charger", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page);
      // Held, so the wait is on screen long enough to read.
      let answer: () => void = () => {};
      const held = new Promise<void>((resolve) => (answer = resolve));
      await page.route(`**${detectPath}`, async (route) => {
        await held;
        await route.fallback();
      });
      await page.goto("/");

      const dialog = await placeCharger(page, "dock-a");
      const detect = dialog.getByRole("button", { name: "Detect charger" });
      await detect.click();

      await expect(dialog.getByText("Looking for the charger… up to 8 s")).toBeVisible();
      await expect(detect).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
      await expect(
        dialog.getByRole("button", { name: "Use robot position" }),
      ).toBeDisabled();
      answer();

      // The readouts are the sighting's, not the drag's or the robot's.
      await expect(dialog.getByText("Charger found.")).toBeVisible();
      await expect(dialog.getByText("2.40")).toBeVisible();
      await expect(dialog.getByText("-1.10")).toBeVisible();
      await expect(dialog.getByText("0.03")).toBeVisible();
      await expect(dialog.getByText("-45.0")).toBeVisible();
      await expect(dialog.getByLabel("Name")).toHaveValue("dock-a");
      await expect(dialog.getByRole("combobox", { name: "Type" })).toContainText("Charger");
      expect(detects(writes)).toEqual([{ method: "POST", path: detectPath, body: {} }]);
      // Measuring wrote nothing: the waypoint is still only a draft.
      expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);

      // Pressed again, it measures again.
      await detect.click();
      await expect.poll(() => detects(writes)).toHaveLength(2);
      await expect(detect).toBeEnabled();

      await dialog.getByRole("button", { name: "Create" }).click();
      await expect
        .poll(() => writes.filter((w) => w.path === verticesPath))
        .toHaveLength(1);
      const body = writes.find((w) => w.path === verticesPath)!.body as unknown[];
      expect(body).toHaveLength(1);
      // z as measured: not looked up again under the point.
      expect(body[0]).toMatchObject({
        name: "dock-a",
        type: "CHARGE",
        x: CHARGER_SIGHTING.x,
        y: CHARGER_SIGHTING.y,
        z: CHARGER_SIGHTING.z,
        theta: CHARGER_SIGHTING.theta,
      });
      await expect(dialog).toHaveCount(0);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("keeps the dialog open with the backend's sentence when no charger is seen, and looks again", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page);
      const sentence =
        "The charger was not seen steadily. Point the robot at it and try again.";
      // Counted here: the refused press never reaches the fake's write log.
      let presses = 0;
      let refuse = true;
      await page.route(`**${detectPath}`, (route) => {
        presses += 1;
        return refuse
          ? route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ detail: sentence, code: "landmark_not_detected" }),
            })
          : route.fallback();
      });
      await page.goto("/");

      const dialog = await placeCharger(page, "dock-a");
      const detect = dialog.getByRole("button", { name: "Detect charger" });
      await detect.click();

      await expect(dialog.getByRole("alert")).toHaveText(sentence);
      await expect(dialog.getByLabel("Name")).toHaveValue("dock-a");
      // The placed pose stands: a failed look measured nothing. Read off the
      // heading, since the drag aimed along +x and the sighting faces -45°.
      await expect(dialog.getByText("-45.0")).toHaveCount(0);

      refuse = false;
      await detect.click();
      await expect(dialog.getByText("Charger found.")).toBeVisible();
      await expect(dialog.getByText("-45.0")).toBeVisible();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      expect(presses).toBe(2);
      expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);
      // The refused request is Chromium's own log line (auto-localize.spec.ts).
      expect(
        errors.filter((text) => !/Failed to load resource/.test(text)),
        "the page logged errors",
      ).toEqual([]);
    });

    test("lets go of the dialog when the robot never answers", async ({ page }) => {
      const writes = await mockBackend(page);
      await page.route(`**${detectPath}`, (route) => route.abort("connectionfailed"));
      await page.goto("/");

      const dialog = await placeCharger(page, "dock-a");
      await dialog.getByRole("button", { name: "Detect charger" }).click();

      // No sentence came back to show, so there is nothing to keep it open for.
      await expect(dialog).toHaveCount(0);
      expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);
    });

    test("is offered for a Charger only", async ({ page }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      await mockBackend(page);
      await page.goto("/");

      await placeOnMap(page);
      const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
      const detect = dialog.getByRole("button", { name: "Detect charger" });
      // A new waypoint opens as a Move.
      await expect(dialog.getByRole("combobox", { name: "Type" })).toContainText("Move");
      await expect(detect).toHaveCount(0);

      await dialog.getByRole("combobox", { name: "Type" }).click();
      await page.getByRole("option", { name: /^Charger/ }).click();
      await expect(detect).toBeEnabled();

      await dialog.getByRole("combobox", { name: "Type" }).click();
      await page.getByRole("option", { name: /^Move/ }).click();
      await expect(detect).toHaveCount(0);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test("is greyed, saying why, while the robot does not know where it is", async ({
      page,
    }) => {
      const errors: string[] = [];
      failOnConsoleErrors(page, errors);
      const writes = await mockBackend(page, {
        state: robotState({ localization_valid: false }),
      });
      await page.goto("/");

      const dialog = await placeCharger(page, "dock-a");
      const detect = dialog.getByRole("button", { name: "Detect charger" });
      await expect(detect).toBeDisabled();
      await expect(
        dialog.getByText("The robot does not know where it is yet."),
      ).toHaveCount(1);
      await detect.click({ force: true });
      expect(detects(writes)).toEqual([]);
      expect(errors, "the page logged errors").toEqual([]);
    });

    test.describe("from Add charger", () => {
      test("places a Charger where the map is pressed, asking the robot nothing", async ({
        page,
      }) => {
        const errors: string[] = [];
        failOnConsoleErrors(page, errors);
        const writes = await mockBackend(page);
        await page.goto("/");

        await placeOnMap(page, "Add charger");
        const dialog = page.getByRole("alertdialog", { name: "Add charger" });
        const type = dialog.getByRole("combobox", { name: "Type" });
        await expect(type).toContainText("Charger");
        await expect(type).toBeDisabled();
        await expect(dialog.getByRole("button", { name: "Detect charger" })).toBeEnabled();
        await dialog.getByLabel("Name").fill("dock-a");
        await dialog.getByRole("button", { name: "Create" }).click();

        await expect
          .poll(() => writes.filter((w) => w.path === verticesPath))
          .toHaveLength(1);
        const body = writes.find((w) => w.path === verticesPath)!.body as {
          type: string;
          theta: number;
        }[];
        // The press's pose: aimed along +x, not the sighting's -45°.
        expect(body[0]).toMatchObject({ name: "dock-a", type: "CHARGE" });
        expect(body[0].theta).not.toBe(CHARGER_SIGHTING.theta);
        // Only Detect charger asks the robot to look.
        expect(detects(writes)).toEqual([]);
        await expect(page.getByRole("button", { name: "Add charger" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
        expect(errors, "the page logged errors").toEqual([]);
      });

      test("takes the measured pose when Detect charger is pressed", async ({ page }) => {
        const errors: string[] = [];
        failOnConsoleErrors(page, errors);
        const writes = await mockBackend(page);
        await page.goto("/");

        await placeOnMap(page, "Add charger");
        const dialog = page.getByRole("alertdialog", { name: "Add charger" });
        await dialog.getByLabel("Name").fill("dock-a");
        expect(detects(writes)).toEqual([]);
        await dialog.getByRole("button", { name: "Detect charger" }).click();
        await expect(dialog.getByText("Charger found.")).toBeVisible();
        // Still Add charger's dialog once the pose is the measured one.
        await expect(dialog.getByRole("combobox", { name: "Type" })).toBeDisabled();
        await dialog.getByRole("button", { name: "Create" }).click();

        await expect
          .poll(() => writes.filter((w) => w.path === verticesPath))
          .toHaveLength(1);
        const body = writes.find((w) => w.path === verticesPath)!.body as unknown[];
        expect(body[0]).toMatchObject({
          name: "dock-a",
          type: "CHARGE",
          x: CHARGER_SIGHTING.x,
          y: CHARGER_SIGHTING.y,
          z: CHARGER_SIGHTING.z,
          theta: CHARGER_SIGHTING.theta,
        });
        expect(detects(writes)).toHaveLength(1);
        expect(errors, "the page logged errors").toEqual([]);
      });

      test("switches with Add waypoint, one armed at a time", async ({ page }) => {
        const errors: string[] = [];
        failOnConsoleErrors(page, errors);
        await mockBackend(page);
        await page.goto("/");

        const waypoint = page.getByRole("button", { name: "Add waypoint" });
        const charger = page.getByRole("button", { name: "Add charger" });
        await charger.click();
        await expect(charger).toHaveAttribute("aria-pressed", "true");
        await waypoint.click();
        await expect(waypoint).toHaveAttribute("aria-pressed", "true");
        await expect(charger).toHaveAttribute("aria-pressed", "false");
        await charger.click();
        await charger.click();
        await expect(charger).toHaveAttribute("aria-pressed", "false");
        await expect(waypoint).toHaveAttribute("aria-pressed", "false");
        expect(errors, "the page logged errors").toEqual([]);
      });
    });
  });

  test("writes nothing when the name is cancelled", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    await page.goto("/");

    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("oops");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await expect(dialog).toHaveCount(0);
    expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  // No console-error guard: the browser logs the 409 itself.
  test("keeps the dialog open with the backend's refusal", async ({ page }) => {
    await mockBackend(page);
    await page.route(/\/api\/v1\/maps\/[^/]+\/vertices$/, (route, request) =>
      request.method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              detail: 'A waypoint named "dock" already exists',
            }),
          })
        : route.fallback(),
    );
    await page.goto("/");

    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await dialog.getByLabel("Name").fill("dock");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      'A waypoint named "dock" already exists',
    );
    await expect(dialog).toBeVisible();
  });

  test("is greyed with no map to put a waypoint on", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [] });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Add waypoint" }),
    ).toBeDisabled();
    // The camera buttons do not need a map.
    await expect(page.getByRole("button", { name: "Recenter" })).toBeEnabled();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("is greyed while a job drives on the map, and comes back when it ends", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    // Mutated below: the fake answers each poll from this array.
    const running = [activeTask()];
    const writes = await mockBackend(page, { activeTasks: running });
    // Waited on, so the grey below is the job's and not the first poll's.
    const answered = page.waitForResponse((r) =>
      r.url().includes("/api/v1/active_tasks"),
    );
    await page.goto("/");
    await answered;
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    const place = page.getByRole("button", { name: "Add waypoint" });
    await expect(place).toBeDisabled();

    // The positive control: the job ends, and the next poll gives the tool
    // back — which is also what proves the grey was the job's.
    running.length = 0;
    await expect(place).toBeEnabled();
    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await dialog.getByLabel("Name").fill("shelf-b");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === verticesPath))
      .toHaveLength(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("is not greyed by a job on another map", async ({ page }) => {
    await mockBackend(page, {
      activeTasks: [activeTask({ map_name: "wh1" })],
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Add waypoint" }),
    ).toBeEnabled();
  });

  test("keeps the name typed when a job starts on the map, and holds Create", async ({
    page,
  }) => {
    const running: Record<string, unknown>[] = [];
    const writes = await mockBackend(page, { activeTasks: running });
    await page.goto("/");

    await placeOnMap(page);
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await dialog.getByLabel("Name").fill("shelf-b");
    running.push(activeTask({ source: "SCHEDULE", schedule_id: "nightly" }));

    await expect(
      dialog.getByText(/The robot is running a job on this map/),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await expect(dialog.getByLabel("Name")).toHaveValue("shelf-b");
    expect(writes.filter((w) => w.path === verticesPath)).toEqual([]);
  });
});

test.describe("tapping a stop on the dashboard", () => {
  const stop = vertex();
  const stopPath = `/api/v1/maps/${MAP_NAME}/vertices/${stop.id}`;

  /**
   * Open the waypoint's panel by tapping its marker. Recenter first, so the
   * view is framedTree's box and the marker stands where recenteredOnScreen
   * says.
   */
  const tapStop = async (page: Page, target: { x: number; y: number; name: string } = stop) => {
    const region = page.getByRole("region", { name: "Map viewport" });
    await expect(region).toBeVisible();
    await page.getByRole("button", { name: "Recenter" }).click();
    const { x, y } = await recenteredOnScreen(page, { ...target, z: GROUND_FLOOR_Z_M });
    // Polled: the tree, and so the framing, can land a few frames late.
    await expect(async () => {
      await page.mouse.click(x, y);
      await expect(page.getByRole("region", { name: target.name })).toBeVisible({
        timeout: 500,
      });
    }).toPass();
  };

  test("deletes the stop once the operator confirms, and closes", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { octomap: framedTree() });
    await page.goto("/");

    await tapStop(page);
    page.once("dialog", (confirm) => {
      expect(confirm.message()).toContain(`Delete "${stop.name}"?`);
      void confirm.accept();
    });
    await page.getByRole("button", { name: `More for ${stop.name}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect
      .poll(() =>
        writes.filter((w) => w.method === "DELETE").map((w) => w.path),
      )
      .toEqual([stopPath]);
    await expect(page.getByRole("region", { name: stop.name })).toHaveCount(0);
    // The layer toggle goes with the last stop: nothing left to hide.
    await expect(page.getByRole("button", { name: "Waypoints" })).toHaveCount(
      0,
    );
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("holds Reposition and Delete while a job drives on its map", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { octomap: framedTree(), activeTasks: [activeTask()] });
    await page.goto("/");

    await tapStop(page);
    const panel = page.getByRole("region", { name: stop.name });
    await expect(panel.getByText(/The robot is running a job on this map/)).toBeVisible();
    await panel.getByRole("button", { name: `More for ${stop.name}` }).click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("menuitem", { name: "Reposition" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      writes.filter((w) => w.path.startsWith(`/api/v1/maps/${MAP_NAME}/vertices`)),
    ).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  const dispatches = <W extends { path: string; method: string }>(writes: W[]) =>
    writes.filter((w) => w.path === "/api/v1/tasks" && w.method === "POST");

  test("clears the goal once the robot arrives, with no Clear to press", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      dispatchedTaskState: (id) => ({
        id,
        status: "COMPLETED",
        steps: [{ id: "1-move", status: "COMPLETED", error_msg: "" }],
      }),
    });
    await page.goto("/");

    await tapStop(page);
    // The tap drew the route; Go on the panel sends it.
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect.poll(() => dispatches(writes)).toHaveLength(1);
    // The failed run below is the positive control: the read-back does show.
    await expect(page.getByRole("region", { name: "Navigation goal" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps a failed goal on screen and sends it again from Retry", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      // No sentence on the step: a FAILED run still owes the operator a Retry.
      dispatchedTaskState: (id) => ({
        id,
        status: "FAILED",
        steps: [{ id: "1-move", status: "FAILED", error_msg: "" }],
      }),
    });
    await page.goto("/");

    await tapStop(page);
    // The tap drew the route; Go on the panel sends it.
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByRole("region", { name: "Navigation goal" })).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();

    await expect.poll(() => dispatches(writes)).toHaveLength(2);
    const [first, again] = dispatches(writes).map(
      (w) => (w.body as { steps: { params: unknown }[] }).steps[0].params,
    );
    expect(again).toEqual(first);
    expect(first).toMatchObject({ x: stop.x, y: stop.y });
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("drops a failed goal's card when the next stop is tapped, so one card is up", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      dispatchedTaskState: (id) => ({
        id,
        status: "FAILED",
        steps: [{ id: "1-move", status: "FAILED", error_msg: "" }],
      }),
    });
    await page.goto("/");

    await tapStop(page);
    await page.getByRole("button", { name: "Go", exact: true }).click();
    // Positive control: the failed goal's card is up before the next tap.
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    await tapStop(page);
    await expect(page.getByRole("region", { name: stop.name })).toBeVisible();
    await expect(page.getByRole("region", { name: "Navigation goal" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    // The tap only cleared the screen: nothing more went to the robot.
    expect(dispatches(writes)).toHaveLength(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("cancels a running goal from the stop's own card, then offers its Go", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    // The run reads as canceled once the console has asked for it.
    let sent: { path: string; method: string }[] = [];
    const canceled = (id: string) =>
      sent.some((w) => w.method === "DELETE" && w.path === `/api/v1/tasks/${id}`);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      dispatchedTaskState: (id) => ({
        id,
        status: canceled(id) ? "CANCELED" : "IN_PROGRESS",
        steps: [
          { id: "1-move", status: canceled(id) ? "CANCELED" : "IN_PROGRESS", error_msg: "" },
        ],
      }),
    });
    sent = writes;
    await page.goto("/");

    await tapStop(page);
    await page.getByRole("button", { name: "Go", exact: true }).click();
    // Positive control: the running goal's own card is up before the tap.
    await expect(page.getByRole("region", { name: "Navigation goal" })).toBeVisible();

    await tapStop(page);
    const card = page.getByRole("region", { name: stop.name });
    // One card: the goal's read-back steps aside, its Cancel is on the stop's.
    await expect(page.getByRole("region", { name: "Navigation goal" })).toHaveCount(0);
    await expect(card.getByText("The robot is on its way here.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Go" })).toHaveCount(0);
    // Asked during the run: no route until it ends.
    expect(previews(writes)).toHaveLength(1);

    await card.getByRole("button", { name: "Cancel" }).click();
    const [job] = dispatches(writes).map((w) => (w.body as { id: string }).id);
    await expect.poll(() => canceled(job)).toBe(true);

    // The run ended, so the stop's route is asked for and Go comes back.
    await expect(card.getByRole("button", { name: "Go" })).toBeEnabled();
    expect(previews(writes)).toHaveLength(2);
    // Closing the card does not bring the canceled goal's back.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("region", { name: "Navigation goal" })).toHaveCount(0);
    expect(dispatches(writes)).toHaveLength(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("holds Go on the next stop picked ahead, and offers it once the robot arrives", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const next = vertex({
      id: "22222222-2222-2222-2222-222222222222",
      name: "shelf-a",
      type: "MOVE",
      x: -6,
      y: -3,
    });
    let arrived = false;
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      vertices: [stop, next],
      dispatchedTaskState: (id) => ({
        id,
        status: arrived ? "COMPLETED" : "IN_PROGRESS",
        steps: [{ id: "1-move", status: arrived ? "COMPLETED" : "IN_PROGRESS", error_msg: "" }],
      }),
    });
    await page.goto("/");

    await tapStop(page);
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByRole("region", { name: "Navigation goal" })).toBeVisible();

    await tapStop(page, next);
    const card = page.getByRole("region", { name: next.name });
    // Picked ahead, not a change of mind: Go stays, held, and names the goal.
    await expect(card.getByText(`The robot is on its way to ${stop.name}.`)).toBeVisible();
    await expect(card.getByRole("button", { name: "Go", exact: true })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    // The goal's Cancel is still to hand, one menu in.
    await card.getByRole("button", { name: `More for ${next.name}` }).click();
    await expect(page.getByRole("menuitem", { name: "Cancel current goal" })).toBeEnabled();
    await page.keyboard.press("Escape");

    arrived = true;
    await expect(card.getByRole("button", { name: "Go", exact: true })).toBeEnabled();
    expect(previews(writes)).toHaveLength(2);
    // Nothing was canceled on the way.
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(dispatches(writes)).toHaveLength(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("writes nothing when the confirm is dismissed", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { octomap: framedTree() });
    await page.goto("/");

    await tapStop(page);
    page.once("dialog", (confirm) => void confirm.dismiss());
    await page.getByRole("button", { name: `More for ${stop.name}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    await expect(page.getByRole("region", { name: stop.name })).toBeVisible();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  const previews = <W extends { path: string; method: string }>(writes: W[]) =>
    writes.filter((w) => w.path === "/api/v1/route_preview" && w.method === "POST");

  test("draws the route to a stop without sending the robot, then Go sends that goal", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      // The job Go sends is followed by its id; a 404 there trips the guard.
      dispatchedTaskState: (id) => ({
        id,
        status: "IN_PROGRESS",
        steps: [{ id: "1-move", status: "IN_PROGRESS", error_msg: "" }],
      }),
    });
    await page.goto("/");

    await tapStop(page);

    // The tap alone asked for the route: from where the robot stands to the stop.
    const card = page.getByRole("region", { name: stop.name });
    await expect(card.getByRole("button", { name: "Go" })).toBeEnabled();
    expect(previews(writes)).toHaveLength(1);
    expect(previews(writes)[0].body).toMatchObject({
      x: stop.x,
      y: stop.y,
      theta: stop.theta,
      map_name: MAP_NAME,
    });
    // Asked, not sent: nothing moved.
    expect(dispatches(writes)).toEqual([]);

    await card.getByRole("button", { name: "Go" }).click();
    await expect.poll(() => dispatches(writes)).toHaveLength(1);
    const job = dispatches(writes)[0].body as {
      map_name: string;
      steps: { params: Record<string, number> }[];
    };
    expect(job.map_name).toBe(MAP_NAME);
    expect(job.steps[0].params).toMatchObject({ x: stop.x, y: stop.y, theta: stop.theta });
    // The panel hands over to the goal's own read-back.
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Navigation goal" })).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("says why a stop has no route, in the console's words, and offers no Go", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      routePreview: () => ({
        body: {
          reachable: false,
          points: [],
          length_m: 0,
          code: "goal_in_keepout",
          message:
            "Planning failed: the goal is inside a keepout zone (goal_in_keepout: zone 'z1')",
        },
      }),
    });
    await page.goto("/");

    await tapStop(page);

    const card = page.getByRole("region", { name: stop.name });
    await expect(card.getByText("The goal is inside a forbidden zone.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Go" })).toBeDisabled();
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0);
    expect(dispatches(writes)).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("still draws a stop's route with the stop engaged, but holds Go", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      octomap: framedTree(),
      state: robotState({
        low_level_mode: { policy: "PPO", motion: "LOCOMOTION", safety_locked: true },
      }),
    });
    await page.goto("/");

    await tapStop(page);

    const card = page.getByRole("region", { name: stop.name });
    // A preview moves nothing, so the stop does not hold it: the route comes
    // back, and the line under it says why Go is held.
    await expect(card.getByText(/^Emergency stop is engaged\./)).toBeVisible();
    await expect(card.getByText("PLANNING")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Go" })).toBeDisabled();
    expect(previews(writes)).toHaveLength(1);
    expect(dispatches(writes)).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("waypoints on an upper floor", () => {
  const O = OCTREE_KEY_ORIGIN;
  const verticesPath = `/api/v1/maps/${MAP_NAME}/vertices`;
  /** Where the fake tree's upper storey stands: kz O+50 at 0.1 m, a cell's centre. */
  const UPSTAIRS_M = 5.05;

  /**
   * Two storeys: the ground floor's 4×4 doormat half a metre under the
   * origin, and a 2F slab whose box is the 20 × 15 m Recenter frames — two
   * far corners are enough for the box, which is what bounds a pick off the
   * ground floor.
   */
  function storeys(): Buffer {
    const occupied: Array<[number, number, number]> = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) occupied.push([O + x, O + y, O - 5]);
    }
    occupied.push(...framingCorners(50));
    return Buffer.from(encodeOctomapBt({ res: 0.1, occupied }));
  }

  const dock = vertex();
  const landing = vertex({
    id: "22222222-2222-2222-2222-222222222222",
    name: "landing",
    type: "MOVE",
    x: -4,
    y: 2,
    theta: 0,
    z: UPSTAIRS_M,
  });

  const showFloor = async (page: Page, name: string) => {
    const floors = page.getByRole("group", { name: "Floor" });
    await floors.getByRole("button", { name }).click();
    await expect(floors.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  };

  /**
   * How far the view is lifted on 2F: Recenter looks at the floor on show,
   * from 2F's ground as the 3D map shows it to the ground floor's drawn one.
   */
  const LIFT_2F_M = UPSTAIRS_M - GROUND_FLOOR_Z_M;

  /** Where a stop stands on screen after Recenter, the view at `viewZ`. */
  const onScreen = (page: Page, stop: { x: number; y: number; z?: number }, viewZ = 0) =>
    recenteredOnScreen(page, { x: stop.x, y: stop.y, z: drawnGround(stop.z ?? 0) }, viewZ);

  test("places a waypoint on the floor shown, at that floor's height", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: storeys(),
      floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
    });
    await page.goto("/");
    await showFloor(page, "2F");

    const region = page.getByRole("region", { name: "Map viewport" });
    const place = page.getByRole("button", { name: "Add waypoint" });
    await place.click();
    const box = (await region.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 4 });
    await page.mouse.up();
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    await dialog.getByLabel("Name").fill("upstairs");
    await dialog.getByRole("button", { name: "Create" }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === verticesPath))
      .toHaveLength(1);
    const [draft] = writes.find((w) => w.path === verticesPath)!.body as { z: number }[];
    // On the 2F slab the 3D map shows, not on the ground floor under it.
    expect(draft.z).toBeCloseTo(UPSTAIRS_M);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("shows only the floor picked's stops, and sends one at its own height", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: storeys(),
      floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
      vertices: [dock, landing],
      // The goal's id is minted on the page, so every id answers: the tracker
      // polls the job the Move sends, and a 404 would trip the error guard.
      taskStates: new Proxy({} as Record<string, Record<string, unknown>>, {
        get: (_, id) => (typeof id === "string" ? taskState({ id }) : undefined),
      }),
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    await showFloor(page, "2F");
    await page.getByRole("button", { name: "Recenter" }).click();

    // The 2F stop opens: the positive control for the tap below.
    const up = await onScreen(page, landing, LIFT_2F_M);
    await expect(async () => {
      await page.mouse.click(up.x, up.y);
      await expect(page.getByRole("region", { name: landing.name })).toBeVisible({
        timeout: 500,
      });
    }).toPass();
    // The route was asked for at the stop's own height, and it climbs.
    await expect(
      page.getByRole("region", { name: landing.name }).getByText("1F → 2F"),
    ).toBeVisible();
    expect(
      writes.find((w) => w.path === "/api/v1/route_preview")!.body,
    ).toMatchObject({ x: -4, y: 2, z: UPSTAIRS_M });
    // The tap drew the route; Go on the panel sends it.
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const task = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      steps: { params: { x: number; y: number; z?: number } }[];
    };
    expect(task.steps[0].params).toMatchObject({ x: -4, y: 2, z: UPSTAIRS_M });

    // The ground floor's stop is not on 2F: hidden, and a tap where it
    // stands opens nothing.
    const down = await onScreen(page, dock, LIFT_2F_M);
    await page.mouse.click(down.x, down.y);
    await page.waitForTimeout(300);
    await expect(page.getByRole("region", { name: dock.name })).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("carries the view up with a floor switch, so 2F stands where the ground floor did", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: storeys(),
      floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
      vertices: [dock, landing],
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    // Framed at the ground floor first; the switch alone must lift it.
    await page.getByRole("button", { name: "Recenter" }).click();
    const floors = page.getByRole("group", { name: "Floor" });
    await floors.getByRole("button", { name: "2F" }).click();

    // Where the stop stands with the view lifted to 2F, not where it would
    // float over a view left looking at the ground floor.
    const up = await onScreen(page, landing, LIFT_2F_M);
    const unlifted = await onScreen(page, landing);
    expect(Math.hypot(up.x - unlifted.x, up.y - unlifted.y)).toBeGreaterThan(40);
    await expect(async () => {
      await page.mouse.click(up.x, up.y);
      await expect(page.getByRole("region", { name: landing.name })).toBeVisible({
        timeout: 500,
      });
    }).toPass();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("follows the robot's floor, holds it on the stair, and stops at a floor pressed", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const state = robotState({
      localization_status: { position: { x: -4, y: 2, z: 5.5, theta: 0 }, velocity: 0 },
    });
    const position = (state.localization_status as { position: { z: number } }).position;
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: storeys(),
      floors: { [MAP_NAME]: { detected: TWO_FLOORS } },
      state,
    });
    await page.goto("/");
    const floors = page.getByRole("group", { name: "Floor" });
    const follow = floors.getByRole("button", { name: "Follow robot" });
    // Off by default: the whole map, as before.
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await expect(floors.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    await follow.click();
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    // The robot's floor is on show, marked rather than pressed: Follow is the choice.
    const twoF = floors.getByRole("button", { name: "2F" });
    await expect(twoF).toHaveAttribute("aria-current", "true");
    await expect(twoF).toHaveAttribute("aria-pressed", "false");

    // On the stair, between the two floors' bands: still 2F, not All.
    position.z = 3;
    await page.waitForTimeout(2500);
    await expect(twoF).toHaveAttribute("aria-current", "true");

    // Down on the ground floor: the view follows.
    position.z = 0;
    await expect(floors.getByRole("button", { name: "1F" })).toHaveAttribute("aria-current", "true");

    // A floor pressed ends it.
    await twoF.click();
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await expect(twoF).toHaveAttribute("aria-pressed", "true");
    position.z = 5.5;
    await page.waitForTimeout(1500);
    await expect(floors.getByRole("button", { name: "1F" })).not.toHaveAttribute("aria-current", "true");
    await expect(twoF).toHaveAttribute("aria-pressed", "true");
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the pose readout", () => {
  const pose = (page: Page) => page.getByRole("region", { name: "Pose" });

  test("reads the robot's height beside X and Y, and masks all three before it is localized", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const state = robotState({
      localization_status: {
        position: { x: 1.25, y: -3.5, z: 3.274, theta: 90 },
        velocity: 0,
      },
    });
    await mockBackend(page, { state });
    await page.goto("/");

    await expect(pose(page)).toContainText("X1.25");
    await expect(pose(page)).toContainText("Y-3.50");
    await expect(pose(page)).toContainText("Z3.27");
    await expect(pose(page)).toContainText("Orientation90.0");

    // A zeroed placeholder would read as standing on the map origin.
    state.localization_valid = false;
    await expect(pose(page)).toContainText("Z—");
    await expect(pose(page)).not.toContainText("3.27");
    expect(errors, "the page logged errors").toEqual([]);
  });
});
