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

    await expect(page.getByRole("button", { name: "Top down" })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps the scan it has through a floor plan rebuild", async ({
    page,
  }) => {
    // A rebuild moves the catalogue's modified_at but leaves the scan alone,
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

  test("downloads the running map's tree once, and only when asked", async ({
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

    // A million cells to decode and draw: only when someone asks to see them.
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    expect(treeReads).toEqual([]);
    expect(patchReads).toEqual([]);

    await toggle(page).click();
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
    await mockBackend(page);
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: "Top down" })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("shows one floor at a time of a map that spans storeys, and looks at it level", async ({
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
    // The floors are picked on the 3D map, so not offered while it is hidden.
    await expect(page.getByRole("group", { name: "Floor" })).toHaveCount(0);

    await toggle(page).click();
    const floors = page.getByRole("group", { name: "Floor" });
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
    // Front view frames the floor on show, here one with no cells at all.
    await page.getByRole("button", { name: "Front view" }).click();
    await floors.getByRole("button", { name: "All" }).click();
    await page.getByRole("button", { name: "Front view" }).click();
    await page.waitForTimeout(500);
    expect(floorReads).toEqual([`/api/v1/maps/${MAP_NAME}/floors`]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("offers no floors for a map of one storey", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { maps: [mapSummary(withOctomap())] });
    await page.goto("/");
    // Front view is the 3D map's: a floor plan from the front is a line.
    await expect(page.getByRole("button", { name: "Front view" })).toHaveCount(0);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Front view" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByRole("group", { name: "Floor" })).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("opens on the 3D map of a map that has no floor plan", async ({ page }) => {
    // A scan-only save: no floor plan, so no ground plane and nothing to
    // frame — the tree is what the viewport has, so it is up without asking,
    // and Top down frames on it.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, {
      maps: [
        mapSummary({
          grid: null,
          thumbnail: null,
          grid_status: "none",
          ...withOctomap(),
        }),
      ],
    });
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
    await page.getByRole("button", { name: "Top down" }).click();
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
    await toggle(page).click();
    await expect.poll(() => treeReads).toEqual([treePath]);

    entry.octomap_version = "2-2";
    await page.getByRole("link", { name: "Maps" }).click();
    await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(
      page.getByRole("region", { name: "Map viewport" }),
    ).toBeVisible();
    await toggle(page).click();
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

    await toggle(page).click();
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
  const placeOnMap = async (page: Page) => {
    const region = page.getByRole("region", { name: "Map viewport" });
    await expect(region).toBeVisible();
    const place = page.getByRole("button", { name: "Add waypoint" });
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
   * Open the waypoint's dialog by tapping its marker. Top down first, because
   * from overhead the floor is a plain scale (20 x 15 m map, 8 % margin, 60°
   * fov), so the waypoint lands a known number of pixels from the centre.
   */
  const tapStop = async (page: Page) => {
    const region = page.getByRole("region", { name: "Map viewport" });
    await expect(region).toBeVisible();
    await page.getByRole("button", { name: "Top down" }).click();
    const box = (await region.boundingBox())!;
    const tanHalfFov = Math.tan(Math.PI / 6);
    const height =
      Math.max(7.5 / tanHalfFov, 10 / (tanHalfFov * (box.width / box.height))) *
      1.08;
    const pxPerM = box.height / (2 * height * tanHalfFov);
    const x = box.x + box.width / 2 + (stop.x - -2.3) * pxPerM;
    const y = box.y + box.height / 2 - (stop.y - -0.3) * pxPerM;
    // Polled: the camera eases into the overhead view over a few frames.
    await expect(async () => {
      await page.mouse.click(x, y);
      await expect(
        page.getByRole("alertdialog", { name: `Move to ${stop.name}` }),
      ).toBeVisible({
        timeout: 500,
      });
    }).toPass();
  };

  test("deletes the stop once the operator confirms, and closes", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    await page.goto("/");

    await tapStop(page);
    page.once("dialog", (confirm) => {
      expect(confirm.message()).toContain(`Delete "${stop.name}"?`);
      void confirm.accept();
    });
    await page.getByRole("button", { name: "Delete" }).click();

    await expect
      .poll(() =>
        writes.filter((w) => w.method === "DELETE").map((w) => w.path),
      )
      .toEqual([stopPath]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
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
    const writes = await mockBackend(page, { activeTasks: [activeTask()] });
    await page.goto("/");

    await tapStop(page);
    const dialog = page.getByRole("alertdialog", { name: `Move to ${stop.name}` });
    await expect(
      dialog.getByText(/The robot is running a job on this map/),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Reposition" }),
    ).toBeDisabled();
    expect(
      writes.filter((w) => w.path.startsWith(`/api/v1/maps/${MAP_NAME}/vertices`)),
    ).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("writes nothing when the confirm is dismissed", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    await page.goto("/");

    await tapStop(page);
    page.once("dialog", (confirm) => void confirm.dismiss());
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(
      page.getByRole("alertdialog", { name: `Move to ${stop.name}` }),
    ).toBeVisible();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
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
   * origin, and a 2F slab whose box spans 60 m — two far corners are enough
   * for the box, which is what bounds a pick off the ground floor — so a
   * press anywhere on the screen lands inside it.
   */
  function storeys(): Buffer {
    const occupied: Array<[number, number, number]> = [];
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) occupied.push([O + x, O + y, O - 5]);
    }
    occupied.push([O - 300, O - 300, O + 50], [O + 300, O + 300, O + 50]);
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
    await page.getByRole("button", { name: /^3D map/ }).click();
    const floors = page.getByRole("group", { name: "Floor" });
    await floors.getByRole("button", { name }).click();
    await expect(floors.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  };

  /**
   * Where a stop stands on screen from Top down (see tapStop above for the
   * framing), lifted by its height: a stop nearer the camera stands further
   * from the centre, by the camera's height over the height it is still to go.
   */
  const onScreen = async (page: Page, stop: { x: number; y: number; z?: number }) => {
    const region = page.getByRole("region", { name: "Map viewport" });
    const box = (await region.boundingBox())!;
    const tanHalfFov = Math.tan(Math.PI / 6);
    const height =
      Math.max(7.5 / tanHalfFov, 10 / (tanHalfFov * (box.width / box.height))) * 1.08;
    const lift = height / (height - (stop.z ?? 0));
    const pxPerM = (box.height / (2 * height * tanHalfFov)) * lift;
    return {
      x: box.x + box.width / 2 + (stop.x - -2.3) * pxPerM,
      y: box.y + box.height / 2 - (stop.y - -0.3) * pxPerM,
    };
  };

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
    await page.getByRole("button", { name: "Top down" }).click();

    // The 2F stop opens: the positive control for the tap below.
    const up = await onScreen(page, landing);
    await expect(async () => {
      await page.mouse.click(up.x, up.y);
      await expect(
        page.getByRole("alertdialog", { name: `Move to ${landing.name}` }),
      ).toBeVisible({ timeout: 500 });
    }).toPass();
    // Its height is read back beside X and Y: the stop says it is upstairs.
    await expect(
      page
        .getByRole("alertdialog", { name: `Move to ${landing.name}` })
        .getByText(UPSTAIRS_M.toFixed(2)),
    ).toBeVisible();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const task = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      steps: { params: { x: number; y: number; z?: number } }[];
    };
    expect(task.steps[0].params).toMatchObject({ x: -4, y: 2, z: UPSTAIRS_M });

    // The ground floor's stop is not on 2F: hidden, and a tap where it
    // stands opens nothing.
    const down = await onScreen(page, dock);
    await page.mouse.click(down.x, down.y);
    await page.waitForTimeout(300);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });
});
