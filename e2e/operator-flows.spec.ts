import { expect, test, type Page } from "@playwright/test";

import {
  MAP_NAME,
  failOnConsoleErrors,
  floorPlanPng,
  mapSummary,
  mockBackend,
  recording,
  robotState,
  taskHistoryEntry,
  taskTemplate,
  vertex,
} from "./backend";

/**
 * The flows where pressing a button does something to a real machine. Each one
 * asserts two halves that can drift apart: what the screen says, and what the
 * console actually sent. A test that only checks the screen passes a build that
 * posts to the wrong endpoint.
 */

test.describe("the recorder", () => {
  test("shows the idle form when nothing is recording", async ({ page }) => {
    // Which face is shown comes from the server, not from a local flag, so a
    // recording started from a shell is reflected correctly.
    await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await expect(page.getByRole("button", { name: /start recording/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  });

  test("shows the live face and the robot's own elapsed clock", async ({ page }) => {
    await mockBackend(page, {
      activeRecording: {
        name: "rec_live",
        path: "/home/syncai/record/rec_live",
        topics: ["/robot01/livox/lidar"],
        started_at: "2026-09-18T09:22:00Z",
        elapsed_seconds: 75,
        compression: false,
        size_bytes: 1024 * 1024,
      },
    });
    await page.goto("/recordings");

    // Exact, because "Recordings" (the rail link and the page heading) would
    // otherwise match too.
    await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    // 75 s as the robot measured it, not a timer this console started.
    await expect(page.getByText("1:15")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toHaveCount(0);
  });

  test("posts a start with the name and topics that were on screen", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("field-run-3");
    await page.getByRole("button", { name: /start recording/i }).click();

    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/recordings"))
      .toHaveLength(1);
    const body = writes[0].body as {
      name: string;
      topics: string[];
      compression: boolean;
    };
    expect(body.name).toBe("field-run-3");
    expect(body.topics.length).toBeGreaterThan(0);
    // Compressed unless the operator turns it off.
    expect(body.compression).toBe(true);
  });

  test("refuses the reserved name before a request goes out", async ({ page }) => {
    // "active" is the status route's own path; a directory called that could
    // never be read back, and the backend refuses it too.
    const writes = await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await page.getByLabel("Recording name").fill("active");
    await expect(page.getByText(/reserved/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toBeDisabled();
    expect(writes).toHaveLength(0);
  });

  test("lists what is on disk", async ({ page }) => {
    await mockBackend(page, {
      recordings: [recording({ name: "rec_a" }), recording({ name: "rec_b" })],
    });
    await page.goto("/recordings");

    await expect(page.getByText("rec_a")).toBeVisible();
    await expect(page.getByText("rec_b")).toBeVisible();
  });
});

test.describe("the map library", () => {
  test("marks the map the stack is running and locks it", async ({ page }) => {
    // The running map is the one map that cannot be renamed or deleted — the
    // backend refuses both, and the card says so rather than letting the
    // operator find out from a 409.
    await mockBackend(page, { maps: [mapSummary({ active: true })] });
    await page.goto("/maps");

    await expect(page.getByRole("heading", { name: MAP_NAME })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Delete ${MAP_NAME}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Rename ${MAP_NAME}` }),
    ).toHaveCount(0);
  });

  test("puts a delete behind a dialog that names what goes with it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site", vertex_count: 3 }),
      ],
    });
    await page.goto("/maps");

    await page.getByRole("button", { name: "Delete old-site" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("old-site");
    // The waypoints are the part that surprises: hand-placed work that does not
    // live in the map directory being removed.
    await expect(dialog).toContainText("3 saved waypoints");

    // Backing out sends nothing.
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes.filter((w) => w.method === "DELETE")).toHaveLength(0);
  });

  test("sends the delete only after the dialog is confirmed", async ({ page }) => {
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site" }),
      ],
    });
    await page.goto("/maps");

    await page.getByRole("button", { name: "Delete old-site" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/maps/old-site");
  });

  test("explains a conversion that failed instead of showing a hole", async ({
    page,
  }) => {
    await mockBackend(page, {
      maps: [
        mapSummary({
          active: false,
          name: "bad-cloud",
          grid: null,
          thumbnail: null,
          grid_status: "failed",
          grid_error: "intensity/normal gate selected no ground points",
        }),
      ],
    });
    await page.goto("/maps");

    await expect(
      page.getByText("intensity/normal gate selected no ground points"),
    ).toBeVisible();
  });
});

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
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();

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
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Top down" })).toBeVisible();
    await expect(toggle(page)).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps the scan it has through a floor plan rebuild", async ({ page }) => {
    // A rebuild rewrites the floor plan, which moves the catalogue's
    // modified_at, and leaves map.pcd alone. The scan is hundreds of thousands
    // of points, so a new directory time must not cost a second download.
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
      await expect(page.getByRole("heading", { name: "Maps", level: 1 })).toBeVisible();
      await page.getByRole("link", { name: "Dashboard" }).click();
      await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    };

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
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
    const alert = page.getByRole("alert").filter({ hasText: "has no saved scan" });
    await expect(alert).toHaveText(`Map '${MAP_NAME}' has no saved scan`);

    // Turning the layer off is what dismisses it.
    await toggle(page).click();
    await expect(alert).toHaveCount(0);
  });
});

test.describe("the dashboard's forbidden zone layer", () => {
  const toggle = (page: Page) => page.getByRole("button", { name: /^Forbidden zones/ });
  const zone = {
    id: "zone-1",
    points: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 0, y: 1 },
    ],
  };

  test("reads the running map's zones and draws them, on by default", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { keepout: { [MAP_NAME]: [zone] } });
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/keepout")) reads.push(pathname);
    });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();

    // The zones of the map the robot is on, not of whichever map was edited.
    await expect.poll(() => reads).toEqual([`/api/v1/maps/${MAP_NAME}/keepout`]);
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
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();

    // The positive control: the layer strip is up, with the stops' toggle.
    await expect(page.getByRole("button", { name: /^Waypoints/ })).toBeVisible();
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
    await page.getByRole("option", { name: /^Wait/ }).click();
    await create.click();

    await expect
      .poll(() => writes.filter((w) => w.path === verticesPath))
      .toHaveLength(1);
    const write = writes.find((w) => w.path === verticesPath)!;
    expect(write.method).toBe("POST");
    const body = write.body as { name: string; type: string; x: number; y: number; theta: number }[];
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("shelf-b");
    expect(body[0].type).toBe("WAITING");
    expect(Number.isFinite(body[0].x)).toBe(true);
    expect(Number.isFinite(body[0].y)).toBe(true);
    // A drag to screen-right on the opening view aims along map +x.
    expect(Math.abs(body[0].theta)).toBeLessThan(30);

    // The echoed row closed the dialog: the create parsed and was spliced in.
    await expect(dialog).toHaveCount(0);
    // And the tool disarmed on release, so a stray click cannot place another.
    await expect(page.getByRole("button", { name: "Add waypoint" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
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
    expect(body[0]).toMatchObject({ name: "where-it-stands", x: 1.25, y: -3.5, theta: 90 });
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
            body: JSON.stringify({ detail: 'A waypoint named "dock" already exists' }),
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
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Add waypoint" })).toBeDisabled();
    // The camera buttons do not need a map.
    await expect(page.getByRole("button", { name: "Recenter" })).toBeEnabled();
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("tapping a stop on the dashboard", () => {
  const stop = vertex();
  const stopPath = `/api/v1/maps/${MAP_NAME}/vertices/${stop.id}`;

  /**
   * Open the stop's dialog by tapping its marker. Top down first, because
   * from overhead the floor is a plain scale: the fake map is 20 x 15 m
   * about (-2.3, -0.3) and overheadDistance frames its height with an 8 %
   * margin at a 60° fov, so the stop at (2.5, 1.25) lands a known number of
   * pixels from the region's centre.
   */
  const tapStop = async (page: Page) => {
    const region = page.getByRole("region", { name: "Map viewport" });
    await expect(region).toBeVisible();
    await page.getByRole("button", { name: "Top down" }).click();
    const box = (await region.boundingBox())!;
    const tanHalfFov = Math.tan(Math.PI / 6);
    const height =
      Math.max(7.5 / tanHalfFov, 10 / (tanHalfFov * (box.width / box.height))) * 1.08;
    const pxPerM = box.height / (2 * height * tanHalfFov);
    const x = box.x + box.width / 2 + (stop.x - -2.3) * pxPerM;
    const y = box.y + box.height / 2 - (stop.y - -0.3) * pxPerM;
    // Polled: the camera eases into the overhead view over a few frames.
    await expect(async () => {
      await page.mouse.click(x, y);
      await expect(page.getByRole("alertdialog", { name: `Move to ${stop.name}` })).toBeVisible({
        timeout: 500,
      });
    }).toPass();
  };

  test("deletes the stop once the operator confirms, and closes", async ({ page }) => {
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
      .poll(() => writes.filter((w) => w.method === "DELETE").map((w) => w.path))
      .toEqual([stopPath]);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // The layer toggle goes with the last stop: nothing left to hide.
    await expect(page.getByRole("button", { name: "Waypoints" })).toHaveCount(0);
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

    await expect(page.getByRole("alertdialog", { name: `Move to ${stop.name}` })).toBeVisible();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("words and names on the operator's screens", () => {
  // What reaches an operator names what they see, never the stack underneath
  // it, and every control has a name a screen reader can say. Both are easy to
  // lose in a string nobody reads twice.
  let errors: string[];

  test.beforeEach(({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("says a recording is compressed without naming the format", async ({ page }) => {
    await mockBackend(page, { recordings: [recording({ compression: "zstd" })] });
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
    await expect(header.getByText(/gridmap\.yaml|map\//)).toHaveCount(0);
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

    state.map = "map/wh1/gridmap.yaml";
    here.active = false;
    there.active = true;
    await expect(header.getByText("wh1", { exact: true })).toBeVisible();
  });

  test("names a motor the leg grid does not place by where it is", async ({ page }) => {
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
    await expect(telemetry.getByText("FL Ankle", { exact: true })).toBeVisible();
    await expect(telemetry.getByText("Other motor 1", { exact: true })).toBeVisible();
    await expect(telemetry.getByText(/_joint|waist_motor/)).toHaveCount(0);
  });

  test("names the settings pickers by the labels beside them", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/settings");

    await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Language" })).toBeVisible();
  });

  test("names the waypoint field and the editor in the operator's words", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await expect(page.getByRole("toolbar", { name: "Draw" })).toBeVisible();
    await expect(page.getByText(/gridmap|vertices/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Place" }).click();
    const canvas = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    // Focused on arrival, and reachable by its name rather than a placeholder
    // that disappears the moment something is typed.
    await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
  });

  test("sends an operator to the button that builds a missing floor plan", async ({
    page,
  }) => {
    await mockBackend(page, {
      maps: [mapSummary({ grid: null, thumbnail: null, grid_status: "none" })],
    });
    await page.goto(`/maps/${MAP_NAME}/edit`);

    await expect(
      page.getByText(`"${MAP_NAME}" has no floor plan yet. Build one from the map's card`),
    ).toBeVisible();
  });
});

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
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await page.goto("/tasks");

    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    expect(asked).toMatch(/unsaved steps/);
    // Rows come back folded, read back as the line they say.
    await expect(page.getByText("\u201cArrived\u201d")).toBeVisible();

    await page.goto("/tasks");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    await expect(page.getByText("\u201cArrived\u201d")).toHaveCount(0);
    expect(writes).toEqual([]);
  });

  test("counts a job's paused schedules, and points at them in the list", async ({
    page,
  }) => {
    // Three schedules, two paused: the chip used to read a green
    // "3 schedules" and leave the pauses to a hover title a finger never sees.
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
        { id: "other", trigger: { interval_seconds: 3600 }, paused: false, next_run_times: [] },
        linked("weekend", true),
        linked("holiday", true),
      ],
    });
    await page.goto("/tasks");

    const chip = page.getByRole("button", { name: /^Show the schedules for "Morning round"/ });
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

  test("lists another map's jobs, marked and not runnable", async ({ page }) => {
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
    await expect(page.getByText("Saved for wh1; the robot has dp2f loaded.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: 'Dispatch "Second floor" now' }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: 'Schedule "Second floor"' })).toBeDisabled();
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
    // The complaint: halfway through a job the operator notices the map is
    // missing a stop, and the only way to add one was to leave — which threw
    // the job away. The link opens that map's editor in Waypoints mode, the
    // editor's back button returns here, and the draft (steps, the loaded
    // template) is as it was, across a reload too.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");

    await page.getByRole("link", { name: "Add waypoints on the floor plan" }).click();
    await expect(page).toHaveURL(/\/maps\/dp2f\/edit\?mode=vertex&from=tasks$/);
    // Opened with Waypoint chosen to draw, not with nothing chosen as the
    // editor otherwise opens.
    await expect(page.getByRole("combobox", { name: "Draw" })).toContainText("Waypoint");

    await page.getByRole("button", { name: "Back to tasks" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const asLeft = async () => {
      await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
      await expect(page.getByText(/^dock · \(/)).toBeVisible();
      await expect(page.getByText("\u201cArrived\u201d")).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Morning round" })).toHaveCount(0);
    await expect(page.getByText(/^dock · \(/)).toHaveCount(0);
  });

  test("saves over the loaded job, and over the one it just created", async ({
    page,
  }) => {
    // One Save now does both writes Update and Save as new used to split. The
    // rule it has to keep: a loaded template is updated in place, never
    // copied, and a job saved for the first time becomes the loaded one, so a
    // second press does not make a second row.
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
          taskTemplate({ id: method === "POST" ? created : loaded, name: body.name }),
        ),
      });
    });

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => writes).toEqual([
      { method: "PUT", path: `/api/v1/task_templates/${loaded}` },
    ]);

    // A fresh job: created once, then updated. The loaded one is still in
    // the draft, so Create task asks first.
    await page.goto("/tasks");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    const save = page.getByRole("button", { name: "Save", exact: true });
    // No name yet: Save opens the heading to name it, and confirming saves.
    await save.click();
    expect(writes).toHaveLength(1);
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "greeting" })).toBeVisible();
    await save.click();
    await expect.poll(() => writes.slice(1)).toEqual([
      { method: "POST", path: "/api/v1/task_templates" },
      { method: "PUT", path: `/api/v1/task_templates/${created}` },
    ]);
    // Nothing in the editor runs the robot any more.
    await expect(page.getByRole("button", { name: "Dispatch" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "When to run" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create schedule" })).toHaveCount(0);
  });

  test("renames a saved job by name alone, and backs out without a write", async ({
    page,
  }) => {
    // The PUT is partial on purpose: a rename must not also save step edits
    // the operator has not saved yet.
    const template = "22222222-2222-2222-2222-222222222222";
    await mockBackend(page);
    const puts: unknown[] = [];
    await page.route(`**/api/v1/task_templates/${template}`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON() as { name: string };
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
    // An unsaved step edit the rename must leave alone.
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();

    const rename = page.getByRole("button", { name: "Rename task" });
    const field = page.getByRole("textbox", { name: "Task name" });
    await rename.click();
    await expect(field).toHaveValue("Morning round");
    await field.fill("Evening round");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    // Back on the button that opened it.
    await expect(rename).toBeFocused();
    expect(puts).toEqual([]);

    await rename.click();
    await field.fill("Evening round");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Evening round" })).toBeVisible();
    expect(puts).toEqual([{ name: "Evening round" }]);
  });

  test("deletes the loaded job only once confirmed, and leaves", async ({ page }) => {
    // Delete sits beside Save, so a dismissed confirm must send nothing; and
    // the confirm names the schedules that will outlive the job, since each
    // keeps its own copy of the steps.
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
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const remove = page.getByRole("button", { name: "Delete", exact: true });

    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await remove.click();
    expect(asked).toContain('"Morning round"');
    expect(asked).toContain("Its schedule keeps running");
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

    page.once("dialog", (dialog) => void dialog.accept());
    await remove.click();
    await expect(page).toHaveURL(/\/tasks$/);
    expect(writes.filter((w) => w.method === "DELETE").map((w) => w.path)).toEqual([
      `/api/v1/task_templates/${template}`,
    ]);
    // The draft went with it: the editor opens empty.
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
  });

  test("authors a job for a map the robot is not on", async ({ page }) => {
    // The map picker is what lets a job be built for the second floor while
    // the robot is on the first. Both halves matter: the picker must list that
    // map's waypoints and no other's, and the saved body must name that map —
    // while the run button stays held, because the robot is not there.
    const bay = vertex({
      id: "66666666-6666-6666-6666-666666666666",
      name: "bay-1",
      type: "GENERAL",
      map_name: "wh1",
      x: 1,
      y: 2,
      theta: 0,
    });
    await mockBackend(page, {
      maps: [mapSummary(), mapSummary({ name: "wh1", active: false, vertex_count: 1 })],
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
    await page.getByTitle("Drive to a pose in the map frame.").click();

    // Opens on the loaded map, and says so.
    const map = page.getByRole("combobox", { name: "Map" });
    await expect(map).toContainText("dp2f · loaded");
    await map.click();
    await page.getByRole("option", { name: "wh1" }).click();
    await expect(map).toContainText("wh1");

    const waypoint = page.getByRole("combobox", { name: "Waypoint for step 1" });
    await waypoint.click();
    await expect(page.getByRole("option", { name: "bay-1" })).toBeVisible();
    await expect(page.getByRole("option", { name: "dock" })).toHaveCount(0);
    await page.getByRole("option", { name: "bay-1" }).click();
    await expect(waypoint).toContainText("bay-1");

    // Held, with the reason, until that map is the loaded one.
    await expect(
      page.getByText("This job is for wh1; the robot has dp2f loaded", { exact: false }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Task name" }).fill("to bay");
    await page.keyboard.press("Enter");

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as { map_name: string; steps: { vertex_id: string }[] };
    expect(body.map_name).toBe("wh1");
    expect(body.steps[0].vertex_id).toBe(bay.id);
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

    await expect(page.getByText("Running outside this page")).toBeVisible();
    await expect(page.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(page.getByText("via nightly")).toBeVisible();
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

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/tasks/robot01-task-1758000000-1");
  });

  test("registers a timed schedule as a cron the operator never typed", async ({
    page,
  }) => {
    // The backend's timed trigger is a cron expression, and this console is the
    // one that writes it. The operator picks a clock time and some weekdays;
    // the string those become is asserted here because it is the part a
    // screen-only test cannot see, and the part the scheduler acts on.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page.getByRole("button", { name: 'Schedule "Morning round"' }).click();
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
    // The unit conversion is the one place a screen-only test would pass a
    // build that registers "every 30 seconds" for a robot meant to go every
    // 30 minutes.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page.getByRole("button", { name: 'Schedule "Morning round"' }).click();
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
      // Changing a time used to be a delete and a re-create, which lost the
      // name and a pause. The edit is a PATCH of the trigger alone, asserted
      // here because a build that did the old dance would pass on screen.
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
      await expect(page.getByPlaceholder("robot01-daily-patrol")).toHaveCount(0);
      const save = page.getByRole("button", { name: "Save schedule" });
      await expect(save).toBeDisabled();

      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByLabel("Time").fill("10:30");
      await save.click();

      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({
        method: "PATCH",
        path: "/api/v1/schedules/nightly",
        body: { trigger: { cron: "30 10 * * 1,2,3,4,5", timezone: "Asia/Taipei" } },
      });
      await expect(page.getByText("Edit nightly")).toHaveCount(0);
      await expect(page.getByText("Weekdays at 10:30 · Asia/Taipei")).toBeVisible();
      // Still the same schedule, still paused.
      await expect(page.getByText("nightly", { exact: true })).toBeVisible();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    });

    /**
     * The robot's schedule list trails a write by a second or two. These
     * answer the first two reads after the write with the list as it was,
     * which is the race the single re-read used to lose: a new schedule was
     * missing until someone pressed Refresh.
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
        if (request.method() === "POST" && path.endsWith("/schedule")) registered = true;
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
      await expect(page.getByText("No schedules are registered on this robot.")).toBeVisible();

      await page.getByRole("button", { name: 'Schedule "Morning round"' }).click();
      await page.getByPlaceholder("robot01-daily-patrol").fill("weekday-patrol");
      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByRole("button", { name: "Create schedule" }).click();

      const row = page.getByRole("listitem").filter({ hasText: "weekday-patrol" });
      await expect(row.getByText("Weekdays at 09:00 · Asia/Taipei")).toBeVisible();
      await expect(row.getByText("2099-01-01 09:00", { exact: true })).toBeVisible();
      expect(staleReads).toBe(2);
      // The job's own chip reads the same list, so it catches up with it.
      await expect(
        page.getByRole("button", { name: /^Show the schedules for "Morning round"/ }),
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
      await expect(page.getByText("Daily at 10:30 · Asia/Taipei")).toBeVisible();
      await expect(page.getByText("2099-01-01 10:30", { exact: true })).toBeVisible();
      expect(staleReads).toBe(2);
      // The stale reads never reached the row.
      await expect(page.getByText("Daily at 21:00 · Asia/Taipei")).toHaveCount(0);
    });

    test("lists registered schedules in words", async ({
      page,
    }) => {
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
      await expect(page.getByText("Daily at 21:00 · Asia/Taipei")).toBeVisible();
      await expect(page.getByText("0 21 * * *")).toHaveCount(0);

      // 13:00Z is 21:00 on the operator's clock, and that is the number shown:
      // the UTC readout was the one that made a correct schedule look wrong.
      await expect(
        page.getByText("2026-09-24 21:00", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("UTC", { exact: true })).toHaveCount(0);
    });

    test("re-reads the list once the soonest run has passed, and only then", async ({
      page,
    }) => {
      // The list is not polled, so a schedule that fired while the page was
      // open used to keep showing the time it fired at until Refresh. The
      // soonest run time now sets one timer. This fake answers the first read
      // with a run a moment away and the second with the recomputed time
      // Temporal would give, so the row moving is proof the read happened.
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

test.describe("the manual drive panel", () => {
  test("limits translation to the Max speed it shows, and never rotation", async ({
    page,
  }) => {
    // Both halves: the slider says one number, and the teleop frames the robot
    // receives carry the same one (the panel shows no per-axis readout, so the
    // wire is the only place the scaled value can be read). Keyboard
    // deflection is always full, so without the limit there is no slow drive
    // from the keys.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    const frames: { vx: number; vy: number; wz: number }[] = [];
    await page.routeWebSocket(/\/api\/v1\/robot\/teleop$/, (ws) => {
      ws.onMessage((message) => {
        if (typeof message === "string") frames.push(JSON.parse(message));
      });
    });
    const last = () => frames.at(-1);

    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    const speed = page.getByRole("slider", { name: "Max speed" });
    // Full on every page load, before anything is armed: the panel drives as
    // it did before the limit existed.
    await expect(speed).toHaveAttribute("aria-valuetext", "100 percent of full speed");
    await expect(page.getByText("100%", { exact: true })).toBeVisible();

    await page.getByRole("switch", { name: "Arm manual drive input" }).click();
    await expect(page.getByText("Streaming to robot · 10 Hz")).toBeVisible();

    // Forward and turn together, at full.
    await page.keyboard.down("w");
    await page.keyboard.down("d");
    await expect.poll(last).toEqual({ vx: 1, vy: 0, wz: -1 });

    // Lowered to half with the keys still held: the new limit reaches the
    // frames at once, and rotation does not move with it.
    await speed.focus();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("ArrowLeft");
    await expect(speed).toHaveAttribute("aria-valuetext", "50 percent of full speed");
    await expect.poll(last).toEqual({ vx: 0.5, vy: 0, wz: -1 });
    await expect(page.getByText("50%", { exact: true })).toBeVisible();

    await page.keyboard.up("w");
    await page.keyboard.up("d");
    await expect.poll(last).toEqual({ vx: 0, vy: 0, wz: 0 });

    // A key pressed while the slider still has focus drives too. The slider's
    // thumb is an <input>, and a guard that took every input for a text field
    // left the keys dead until the operator clicked somewhere else.
    await expect(speed).toBeFocused();
    await page.keyboard.down("w");
    await expect.poll(last).toEqual({ vx: 0.5, vy: 0, wz: 0 });
    await page.keyboard.up("w");
    await expect.poll(last).toEqual({ vx: 0, vy: 0, wz: 0 });
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the floor plan editor's draw bar", () => {
  const drawList = (page: Page) => page.getByRole("combobox", { name: "Draw" });
  const choose = async (page: Page, name: string) => {
    await drawList(page).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  const drawBar = (page: Page) => page.getByRole("toolbar", { name: "Editor" });
  const toolNames = (page: Page) =>
    page
      .getByRole("toolbar", { name: "Editor" })
      .getByRole("group", { name: "Tool" })
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));

  test("opens with no type, and offers the tools each type allows", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);

    // No type: Pan alone, lit, and no panel.
    await expect(drawList(page)).toContainText("No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(page.getByRole("button", { name: "Pan", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Wall: the paint tools, and nothing in the row that is not a tool.
    await choose(page, "Wall");
    await expect(drawList(page)).toContainText("Wall");
    await expect.poll(() => toolNames(page)).toEqual(["Pan", "Brush", "Line", "Rect"]);

    await choose(page, "Waypoint");
    await expect.poll(() => toolNames(page)).toEqual(["Pan", "Place", "Select"]);
    await expect(page.getByRole("combobox", { name: "Waypoint type" })).toBeVisible();

    // The list is shut by default, with the count on its header, and the
    // filter narrows it by name.
    const listToggle = page.getByRole("button", { name: /^Waypoints/ });
    await expect(listToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /dock/ })).toHaveCount(0);
    await listToggle.click();
    const filter = page.getByRole("searchbox", { name: "Filter waypoints" });
    await filter.fill("nothing-like-it");
    await expect(page.getByText("No waypoint matches.")).toBeVisible();
    await filter.fill("DOCK");
    await expect(page.getByRole("button", { name: /dock/ })).toBeVisible();

    // Going back to Pan drops a selected waypoint: pick one from the list with
    // Select armed, press Pan, and the panel is back to its list.
    await drawBar(page).getByRole("button", { name: "Select" }).click();
    await page.getByRole("button", { name: /dock/ }).click();
    await expect(page.getByRole("button", { name: "Delete waypoint" })).toBeVisible();
    // The form puts the name and the type on one row, the type as a list.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("dock");
    await expect(page.getByRole("combobox", { name: "Type" })).toContainText("Chg");
    // Editing one waypoint shows that one only: the list is not under the form.
    await expect(page.getByRole("button", { name: /dock/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete waypoint" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Waypoint type" })).toBeVisible();
    await expect(page.getByRole("button", { name: /dock/ })).toBeVisible();

    // Forbidden zone: Shape and Done, and until Shape is armed the map dims
    // behind a line that asks for it. Done has nothing to close yet.
    await choose(page, "Forbidden zone");
    await expect.poll(() => toolNames(page)).toEqual(["Pan", "Shape", "Done", "Remove"]);
    const hint = page.getByRole("status").filter({ hasText: "Select the shape to work with" });
    await expect(hint).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove" })).toBeDisabled();
    await page.getByRole("button", { name: "Shape" }).click();
    await expect(hint).toHaveCount(0);

    // No type is an item of its own, and puts the choice down.
    await choose(page, "No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(page.getByRole("combobox", { name: "Waypoint type" })).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("draws a forbidden zone from three corners, and closes it on the first", async ({ page }) => {
    // The canvas exposes nothing, so the count of finished zones is read off
    // the editor's data-zones attribute — the shape has to *close*, not
    // merely take clicks. Every corner is at least 22 px from the first, so a
    // click on it is unambiguously a new corner and not a close.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const zones = page.locator("[data-zones]");
    const done = page.getByRole("button", { name: "Done" });

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    await expect(zones).toHaveAttribute("data-zones", "0");

    const box = (await canvas.boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const corners = [
      { x: mid.x - 60, y: mid.y - 40 },
      { x: mid.x + 60, y: mid.y - 40 },
      { x: mid.x, y: mid.y + 50 },
    ];
    const first = corners[0];

    // Two corners: not a shape yet, and pressing the first adds nothing.
    await page.mouse.click(corners[0].x, corners[0].y);
    await page.mouse.click(corners[1].x, corners[1].y);
    await expect(done).toBeDisabled();
    await page.mouse.click(first.x, first.y);
    await expect(done).toBeDisabled();

    // A drag with Shape armed pans the map and adds no corner.
    await page.mouse.move(mid.x + 80, mid.y + 80);
    await page.mouse.down();
    await page.mouse.move(mid.x + 140, mid.y + 80, { steps: 4 });
    await page.mouse.up();
    await expect(done).toBeDisabled();
    // Drag the map back so the corners are where they were.
    await page.mouse.move(mid.x + 140, mid.y + 80);
    await page.mouse.down();
    await page.mouse.move(mid.x + 80, mid.y + 80, { steps: 4 });
    await page.mouse.up();

    // The third corner makes it a shape; the first corner closes it.
    await page.mouse.click(corners[2].x, corners[2].y);
    await expect(done).toBeEnabled();
    await page.mouse.click(first.x, first.y);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(done).toBeDisabled();

    // The next shapes are drawn 30 px to either side: a finished zone's
    // corner is where a shape *anchored to it* starts (see the growing test
    // below), so a second shape on the same corners would join the first
    // rather than stand beside it. All three still overlap at `inside`.
    const shifted = (dx: number) => corners.map((corner) => ({ x: corner.x + dx, y: corner.y }));

    // Enter closes the next one.
    for (const corner of shifted(30)) await page.mouse.click(corner.x, corner.y);
    await expect(done).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(zones).toHaveAttribute("data-zones", "2");

    // Done closes the one after that.
    for (const corner of shifted(-30)) await page.mouse.click(corner.x, corner.y);
    await done.click();
    await expect(zones).toHaveAttribute("data-zones", "3");

    // A press inside a finished zone, with nothing in flight, selects it for
    // Remove; the Delete key takes the next one; a press on bare map with a
    // zone selected is a corner, not a second selection.
    const remove = page.getByRole("button", { name: "Remove" });
    const inside = { x: mid.x, y: mid.y - 10 };
    await expect(remove).toBeDisabled();
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeEnabled();
    await remove.click();
    await expect(zones).toHaveAttribute("data-zones", "2");
    await expect(remove).toBeDisabled();
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect(zones).toHaveAttribute("data-zones", "1");
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeEnabled();
    await page.mouse.click(mid.x + 120, mid.y + 100);
    await expect(remove).toBeDisabled();
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");

    // Escape drops a shape in flight and keeps the choice; a second Escape
    // puts the choice down. The finished zone survives both. Off the
    // remaining zone's corners, so this is a shape of its own.
    await page.mouse.click(shifted(30)[0].x, shifted(30)[0].y);
    await page.mouse.click(shifted(30)[1].x, shifted(30)[1].y);
    await page.keyboard.press("Escape");
    await expect(drawList(page)).toContainText("Forbidden zone");
    await expect(page.getByRole("button", { name: "Shape" })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(drawList(page)).toContainText("No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(zones).toHaveAttribute("data-zones", "1");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("selects several zones with Shift and removes them together", async ({ page }) => {
    // Three overlapping zones, each with a spot only it covers. Shift-click
    // adds to the selection and toggles out again; a Shift-click on bare map
    // keeps the selection instead of starting a shape; Remove takes every
    // selected zone at once. The count is read off data-zones, and which
    // zones went is read back through which spots still select.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const zones = page.locator("[data-zones]");
    const done = page.getByRole("button", { name: "Done" });
    const remove = page.getByRole("button", { name: "Remove" });
    const shiftClick = async (at: { x: number; y: number }) => {
      await page.keyboard.down("Shift");
      await page.mouse.click(at.x, at.y);
      await page.keyboard.up("Shift");
    };

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    const box = (await canvas.boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const triangle = (dx: number) => [
      { x: mid.x - 60 + dx, y: mid.y - 40 },
      { x: mid.x + 60 + dx, y: mid.y - 40 },
      { x: mid.x + dx, y: mid.y + 50 },
    ];
    for (const dx of [0, 30, -30]) {
      const corners = triangle(dx);
      for (const corner of [...corners, corners[0]]) await page.mouse.click(corner.x, corner.y);
    }
    await expect(zones).toHaveAttribute("data-zones", "3");
    // A spot only the zone shifted that way covers.
    const only = (dx: number) => ({ x: mid.x + dx * 2.5, y: mid.y - 30 });
    const bare = { x: mid.x, y: mid.y + 120 };

    // Third and second selected; the second toggled out again; Remove takes
    // only the third.
    await page.mouse.click(only(-30).x, only(-30).y);
    await expect(remove).toBeEnabled();
    await shiftClick(only(30));
    await shiftClick(bare);
    await expect(remove).toBeEnabled();
    await expect(done).toBeDisabled();
    await shiftClick(only(30));
    await remove.click();
    await expect(zones).toHaveAttribute("data-zones", "2");
    await page.mouse.click(only(-30).x, only(-30).y);
    await expect(remove).toBeDisabled();
    await page.keyboard.press("Escape");

    // Both remaining, together, from the keyboard.
    await page.mouse.click(only(30).x, only(30).y);
    await shiftClick({ x: mid.x - 50, y: mid.y - 35 });
    await expect(remove).toBeEnabled();
    await page.keyboard.press("Delete");
    await expect(zones).toHaveAttribute("data-zones", "0");
    await expect(remove).toBeDisabled();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("moves a corner of the shape in flight by dragging it, without panning", async ({ page }) => {
    // The canvas exposes no corner positions, so the move is proved through
    // the one rule that depends on where a corner is: the first corner is
    // where a click closes the shape. Drag it 80 px left, and a click at the
    // old spot is a fourth corner while a click at the new one closes. A pan
    // would put the first corner in the same place, so the Cell readout under
    // a fixed screen point is checked before and after: the map did not move.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const zones = page.locator("[data-zones]");
    const done = page.getByRole("button", { name: "Done" });
    const cellReadout = page.getByText("Cell", { exact: true }).locator("..");
    const cellUnder = async (at: { x: number; y: number }) => {
      await page.mouse.move(at.x, at.y);
      let text = "";
      await expect
        .poll(async () => {
          text = ((await cellReadout.textContent()) ?? "").replace("Cell", "").trim();
          return text;
        })
        .not.toBe("—");
      return text;
    };

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();

    const box = (await canvas.boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const corners = [
      { x: mid.x - 60, y: mid.y - 40 },
      { x: mid.x + 60, y: mid.y - 40 },
      { x: mid.x, y: mid.y + 50 },
    ];
    for (const corner of corners) await page.mouse.click(corner.x, corner.y);
    await expect(done).toBeEnabled();
    const probe = { x: mid.x + 100, y: mid.y + 90 };
    const before = await cellUnder(probe);

    // Beyond the deadzone, so it is a move and not the click that closes.
    const moved = { x: corners[0].x - 80, y: corners[0].y };
    await page.mouse.move(corners[0].x, corners[0].y);
    await page.mouse.down();
    await page.mouse.move(moved.x, moved.y, { steps: 6 });
    await page.mouse.up();
    await expect(zones).toHaveAttribute("data-zones", "0");
    await expect(done).toBeEnabled();
    expect(await cellUnder(probe), "the drag panned the map").toBe(before);

    // The old spot is bare map now: a click there is a corner, not a close.
    await page.mouse.click(corners[0].x, corners[0].y);
    await expect(zones).toHaveAttribute("data-zones", "0");
    await expect(done).toBeEnabled();
    // The new spot is the first corner: a click there closes.
    await page.mouse.click(moved.x, moved.y);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(done).toBeDisabled();

    // A finished zone is reshaped the same way once selected. The zone is
    // now the quadrilateral moved, B, C, A(old); a point just inside its top
    // edge selects it. Drag corner B 200 px down so that point falls outside
    // — inside now reads as a first corner (Remove goes off, and Escape
    // drops it) rather than a selection, which is how the move is proved
    // without the canvas exposing a coordinate.
    const remove = page.getByRole("button", { name: "Remove" });
    const inside = { x: corners[1].x - 20, y: corners[1].y + 6 };
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeEnabled();
    await page.mouse.move(corners[1].x, corners[1].y);
    await page.mouse.down();
    await page.mouse.move(corners[1].x, corners[1].y + 200, { steps: 6 });
    await page.mouse.up();
    await expect(remove).toBeEnabled();
    await expect(zones).toHaveAttribute("data-zones", "1");
    expect(await cellUnder(probe), "the handle drag panned the map").toBe(before);
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeDisabled();
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(zones).toHaveAttribute("data-zones", "1");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("grows a finished zone from one of its corners to another", async ({ page }) => {
    // A square, then a bump drawn off its right edge: start on corner B, two
    // corners out to the right, end on corner C. The zone count stays at one
    // and a point in the bump, which was bare map before (a click there was
    // a corner), is inside the zone after (a click there selects it).
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const zones = page.locator("[data-zones]");
    const done = page.getByRole("button", { name: "Done" });
    const remove = page.getByRole("button", { name: "Remove" });

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();

    const box = (await canvas.boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const a = { x: mid.x - 80, y: mid.y - 60 };
    const b = { x: mid.x + 40, y: mid.y - 60 };
    const c = { x: mid.x + 40, y: mid.y + 60 };
    const d = { x: mid.x - 80, y: mid.y + 60 };
    for (const corner of [a, b, c, d, a]) await page.mouse.click(corner.x, corner.y);
    await expect(zones).toHaveAttribute("data-zones", "1");

    // The bump's interior is bare map: a click is a corner, and Escape drops it.
    const bump = { x: mid.x + 100, y: mid.y };
    await page.mouse.click(bump.x, bump.y);
    await expect(remove).toBeDisabled();
    await page.keyboard.press("Escape");

    // Start on B: the zone lights (it is the one the shape goes into), and
    // Done stays off throughout — an anchored shape is not a zone of its own.
    await page.mouse.click(b.x, b.y);
    await expect(remove).toBeEnabled();
    await expect(zones).toHaveAttribute("data-zones", "1");
    await page.mouse.click(mid.x + 140, mid.y - 40);
    await page.mouse.click(mid.x + 140, mid.y + 40);
    await expect(done).toBeDisabled();
    // End on C: still one zone, still selected.
    await page.mouse.click(c.x, c.y);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(remove).toBeEnabled();

    // Put the selection down, then prove the shape: the bump is inside now,
    // and so is the square's own middle.
    await page.keyboard.press("Escape");
    await expect(remove).toBeDisabled();
    await page.mouse.click(bump.x, bump.y);
    await expect(remove).toBeEnabled();
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(mid.x - 20, mid.y);
    await expect(remove).toBeEnabled();

    // The other way round: a shape begun on bare map off the left edge that
    // reaches the zone. Two corners out to the left, then D attaches it and
    // A ends it; the left bump is inside afterwards, and it is still one zone.
    const leftBump = { x: mid.x - 110, y: mid.y };
    await page.keyboard.press("Escape");
    await page.mouse.click(leftBump.x, leftBump.y);
    await expect(remove).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.mouse.click(mid.x - 140, mid.y + 40);
    await page.mouse.click(mid.x - 140, mid.y - 40);
    await expect(remove).toBeDisabled();
    await page.mouse.click(d.x, d.y);
    await expect(remove).toBeEnabled();
    await expect(done).toBeDisabled();
    await page.mouse.click(a.x, a.y);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await page.keyboard.press("Escape");
    await expect(remove).toBeDisabled();
    await page.mouse.click(leftBump.x, leftBump.y);
    await expect(remove).toBeEnabled();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("paints Wall as obstacle cells, and saves them", async ({ page }) => {
    // Both halves: the stroke is made with Wall chosen, and what reaches the
    // robot is the obstacle byte under it. A swapped Wall / Floor mapping
    // would pass a screen-only test and paint walls where they were erased.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    let saved: Buffer | null = null;
    await page.route(/\/api\/v1\/maps\/[^/]+\/grid$/, (route, request) => {
      if (request.method() !== "PUT") return route.fallback();
      saved = request.postDataBuffer();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          name: MAP_NAME,
          etag: "e2e",
          active: true,
          reloaded: true,
          message: "Saved and reloaded.",
        }),
      });
    });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const stroke = async () => {
      const box = (await canvas.boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height * 0.6;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 60, y, { steps: 4 });
      await page.mouse.up();
    };

    // No type: a drag only moves the view, so there is nothing to save.
    await stroke();
    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();

    await choose(page, "Wall");
    await page.getByRole("button", { name: "Brush" }).click();
    await stroke();
    await expect(save).toBeEnabled();

    await save.click();
    await expect.poll(() => saved?.length ?? 0).toBe(400 * 300);
    expect([...saved!].filter((byte) => byte === 0).length).toBeGreaterThan(0);
    // Only walls were painted: nothing turned Unknown on the way.
    expect([...saved!].filter((byte) => byte === 205)).toEqual([]);
    await expect(save).toBeDisabled();
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the floor plan editor's forbidden zones on the robot", () => {
  const choose = async (page: Page, name: string) => {
    await page.getByRole("combobox", { name: "Draw" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  // Near the map's lower-left corner, well away from the middle of the
  // canvas where the tests draw, so a new shape cannot anchor to it.
  const saved = {
    id: "zone-1",
    points: [
      { x: -11.5, y: -7.0 },
      { x: -10.5, y: -7.0 },
      { x: -11.0, y: -6.0 },
    ],
  };

  test("opens with the map's saved zones, and Save sends a new one beside them", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      keepout: { [MAP_NAME]: [saved] },
    });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    const zones = page.locator("[data-zones]");
    const save = page.getByRole("button", { name: "Save" });

    // What the robot holds is on screen, and is not itself a change.
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(save).toBeDisabled();

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    const box = (await canvas.boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const corners = [
      { x: mid.x - 60, y: mid.y - 40 },
      { x: mid.x + 60, y: mid.y - 40 },
      { x: mid.x, y: mid.y + 50 },
    ];
    for (const corner of corners) await page.mouse.click(corner.x, corner.y);
    await page.mouse.click(corners[0].x, corners[0].y);
    await expect(zones).toHaveAttribute("data-zones", "2");
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Forbidden zones saved · in force now" })).toBeVisible();
    await expect(save).toBeDisabled();

    // The whole list, the saved zone first and untouched, the new one under
    // an id of its own — the robot refuses a list that repeats one.
    const puts = writes.filter((w) => w.method === "PUT");
    expect(puts.map((w) => w.path)).toEqual([`/api/v1/maps/${MAP_NAME}/keepout`]);
    const body = puts[0].body as { zones: { id: string; points: { x: number; y: number }[] }[] };
    expect(body.zones).toHaveLength(2);
    expect(body.zones[0]).toEqual(saved);
    expect(body.zones[1].id).not.toBe(saved.id);
    expect(body.zones[1].points).toHaveLength(3);
    // Nothing painted, so nothing of the floor plan went with it.
    expect(writes.filter((w) => w.path.endsWith("/grid"))).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  /**
   * The saved zone's middle on screen. The editor opens fitted, so this is
   * the canvas's own map-to-screen rule: the 400 x 300 floor plan scaled to
   * the shorter side and centred.
   */
  const savedZoneMiddle = async (page: Page) => {
    const box = (await page.locator("canvas").boundingBox())!;
    const scale = Math.min(box.width / 400, box.height / 300);
    const left = box.x + (box.width - 400 * scale) / 2;
    const top = box.y + (box.height - 300 * scale) / 2;
    const px = (-11.0 - -12.3) / 0.05;
    const py = 300 - (-6.6 - -7.8) / 0.05;
    return { x: left + px * scale, y: top + py * scale };
  };

  const drawTriangle = async (page: Page) => {
    const box = (await page.locator("canvas").boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const corners = [
      { x: mid.x - 60, y: mid.y - 40 },
      { x: mid.x + 60, y: mid.y - 40 },
      { x: mid.x, y: mid.y + 50 },
    ];
    for (const corner of corners) await page.mouse.click(corner.x, corner.y);
    await page.mouse.click(corners[0].x, corners[0].y);
  };

  test("Remove takes a zone off the robot at once, and leaves unsaved ones for Save", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      keepout: { [MAP_NAME]: [saved] },
      // Not the map the robot is on: written, but nothing to reload.
      maps: [mapSummary({ active: false })],
    });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();
    const zones = page.locator("[data-zones]");
    const save = page.getByRole("button", { name: "Save" });
    const keepoutPuts = () => writes.filter((w) => w.path.endsWith("/keepout")).map((w) => w.body);
    await expect(zones).toHaveAttribute("data-zones", "1");

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    // A new zone, not saved yet: Save lights, nothing is sent.
    await drawTriangle(page);
    await expect(zones).toHaveAttribute("data-zones", "2");
    await expect(save).toBeEnabled();
    expect(keepoutPuts()).toEqual([]);

    // Remove the saved one. It goes without a Save, and what went is the
    // saved list minus that zone — the unsaved one did not ride along.
    const middle = await savedZoneMiddle(page);
    await page.mouse.click(middle.x, middle.y);
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(page.getByRole("status").filter({ hasText: /^Removed/ })).toBeVisible();
    await expect.poll(keepoutPuts).toEqual([{ zones: [] }]);
    await expect(save).toBeEnabled();

    // Save then writes the one still waiting.
    await save.click();
    await expect.poll(() => keepoutPuts().length).toBe(2);
    const last = keepoutPuts()[1] as { zones: { id: string }[] };
    expect(last.zones).toHaveLength(1);
    expect(last.zones[0].id).not.toBe(saved.id);
    await expect(save).toBeDisabled();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("removing a zone the robot never had sends nothing", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();
    const zones = page.locator("[data-zones]");

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    await drawTriangle(page);
    await expect(zones).toHaveAttribute("data-zones", "1");
    // Inside the triangle, below its top edge.
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 20);
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(zones).toHaveAttribute("data-zones", "0");
    // Back where it opened: nothing to save, nothing was sent.
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(writes.filter((w) => w.path.endsWith("/keepout"))).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  // No console-error guard here: the browser logs the 409 itself, which is
  // exactly the response under test.
  test("puts a zone back when the robot refuses to remove it", async ({ page }) => {
    await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      keepout: { [MAP_NAME]: [saved] },
    });
    const refusal = "A floor plan rebuild is running; save the forbidden zones once it has finished.";
    await page.route(/\/api\/v1\/maps\/[^/]+\/keepout$/, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal, code: "conversion_running" }),
          })
        : route.fallback(),
    );
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();
    const zones = page.locator("[data-zones]");
    await expect(zones).toHaveAttribute("data-zones", "1");

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    const middle = await savedZoneMiddle(page);
    await page.mouse.click(middle.x, middle.y);
    await page.getByRole("button", { name: "Remove" }).click();

    // The planner still keeps to it, so the map shows it again, clean.
    const alert = page.getByRole("alert").filter({ hasText: "Forbidden zone not removed" });
    await expect(alert).toContainText(refusal);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // No console-error guard here: the browser logs the 502 itself, which is
  // exactly the response under test.
  test("locks the zones, and leaves the floor plan editable, when they cannot be read", async ({ page }) => {
    const writes = await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.route(/\/api\/v1\/maps\/[^/]+\/keepout$/, (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "The map's forbidden zones could not be read." }),
      }),
    );
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();

    const alert = page.getByRole("alert").filter({ hasText: "Forbidden zones could not be loaded" });
    // The backend's own sentence under the headline, verbatim.
    await expect(alert).toContainText("The map's forbidden zones could not be read.");
    await page.getByRole("combobox", { name: "Draw" }).click();
    await expect(page.getByRole("option", { name: "Forbidden zone", exact: true })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // The positive control: the rest of the list still works.
    await page.getByRole("option", { name: "Wall", exact: true }).click();
    await expect(page.getByRole("button", { name: "Brush" })).toBeVisible();
    // And no save can go out with an empty list in place of the unread one.
    expect(writes.filter((w) => w.path.endsWith("/keepout"))).toEqual([]);
  });
});

test.describe("the floor plan editor's waypoint list", () => {
  test("shows five rows of twenty, and scrolls to the rest", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const twenty = Array.from({ length: 20 }, (_, i) =>
      vertex({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        name: `stop-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254), vertices: twenty });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);

    const toggle = page.getByRole("button", { name: /^Waypoints/ });
    await expect(toggle).toContainText("20");
    await toggle.click();

    // Rows whose whole box lies inside the list's box are the ones on screen.
    const list = page.locator("ul").filter({ has: page.getByRole("button", { name: /stop-01/ }) });
    const visibleRows = () =>
      list.evaluate((ul) => {
        const box = ul.getBoundingClientRect();
        return [...ul.querySelectorAll("li")].filter((li) => {
          const row = li.getBoundingClientRect();
          return row.top >= box.top - 0.5 && row.bottom <= box.bottom + 0.5;
        }).length;
      });
    await expect.poll(visibleRows).toBe(5);

    // The other fifteen are a scroll away, inside the list.
    await list.evaluate((ul) => ul.scrollTo({ top: ul.scrollHeight }));
    await expect(page.getByRole("button", { name: /stop-20/ })).toBeInViewport();
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the floor plan editor", () => {
  test("aims a new waypoint by the direction it was dragged", async ({ page }) => {
    // The heading rule is shared with the dashboard now, so this holds the
    // editor's half of it end to end: a drag straight up the screen is +y on
    // the map, which is 90°, and that is what has to reach the robot.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    const created: unknown[] = [];
    await page.route(/\/api\/v1\/maps\/[^/]+\/vertices$/, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const [draft] = route.request().postDataJSON() as Record<string, unknown>[];
      created.push(draft);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([vertex({ ...draft, id: "55555555-5555-5555-5555-555555555555" })]),
      });
    });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await page.getByRole("button", { name: "Place" }).click();

    const box = (await page.locator("canvas").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 60, { steps: 6 });
    await page.mouse.up();

    await page.getByRole("textbox", { name: "Name" }).fill("north-door");
    await page.getByRole("button", { name: "Create" }).click();

    await expect.poll(() => created).toHaveLength(1);
    const sent = created[0] as { name: string; theta: number };
    expect(sent.name).toBe("north-door");
    expect(sent.theta).toBeCloseTo(90, 5);
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the step editor", () => {
  test("reorders by menu, drag and keyboard, and saves in the order shown", async ({
    page,
  }) => {
    // Three ways to move a row, one list. The saved body is the half a
    // screen-only test cannot see: the step ids are positional, so a reorder
    // that only moved the DOM would still post the old order.
    await mockBackend(page);
    // The create answers with its echo, which is schema-checked, so this route
    // replaces the generic "ok" — and, being the handler that fulfils it, is
    // where the posted body is read.
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

    // The add row's buttons share their labels with each row's type picker,
    // so they are reached by their hints.
    await page.getByTitle("Stand up. Nothing to set.").click();
    await page.getByTitle("Lie down. Nothing to set.").click();
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Hello");

    const rows = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^Reorder step/ }) });
    // Each row's type label, top to bottom.
    const order = () =>
      rows.evaluateAll((items) =>
        items.map((item) => item.querySelector(".instrument-label")?.textContent),
      );
    await expect.poll(order).toEqual(["Stand", "Lie", "Speak"]);

    // Menu: the last row straight to the top.
    await page.getByRole("button", { name: "More actions for step 3" }).click();
    await page.getByRole("menuitem", { name: "Move to top" }).click();
    await expect.poll(order).toEqual(["Speak", "Stand", "Lie"]);

    // Drag: the last row's handle onto the first row.
    const handle = page.getByRole("button", { name: "Reorder step 3" });
    const from = (await handle.boundingBox())!;
    const to = (await rows.first().boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
    await page.mouse.up();
    await expect.poll(order).toEqual(["Lie", "Speak", "Stand"]);

    // Keyboard: pick the last row up, one slot up, drop.
    // Each key waits for the one before it to land: the sensor measures the
    // rows after pick-up, and a move sent before that is dropped.
    //
    //
    // Two things have to be true before the ArrowUp, and neither is visible on
    // a fast machine, which is why this test failed only under load:
    //
    // - The rows have finished sliding into place after the mouse drop above.
    //   An ArrowUp only targets a row whose measured top is above the lifted
    //   one's, and rows measured mid-transition are not where they will be.
    // - The rows have been measured at all. `aria-pressed` flips on pick-up,
    //   before that. The first "is over" announcement comes after, because
    //   dnd-kit can only say which slot the row is over once it has them all.
    await expect
      .poll(() => rows.evaluateAll((items) => items.every((i) => i.getAnimations().length === 0)))
      .toBe(true);
    const grip = page.getByRole("button", { name: "Reorder step 3" });
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("is over position 3 of 3")).toBeAttached();
    // Even then, about one ArrowUp in thirty under load is dropped outright:
    // the row stays over position 3 for as long as anyone waits, with no late
    // move to follow. The cause was not found. So the key is pressed again, as
    // an operator would, rather than the test failing. The 1.5 s window rests
    // on what was observed, not on anything the code enforces: every key that
    // landed did so in milliseconds, and every dropped one never landed at all.
    // A key that landed later than 1.5 s would be pressed twice, move the row
    // two slots, and fail the order assertion below. That is a failed run,
    // never a wrong pass.
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      await expect(page.getByText("is over position 2 of 3")).toBeAttached({
        timeout: 1_500,
      });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Space");
    await expect.poll(order).toEqual(["Lie", "Stand", "Speak"]);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Task name" }).fill("reorder-check");
    await page.keyboard.press("Enter");

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as { steps: { id: string }[] };
    expect(body.steps.map((step) => step.id)).toEqual([
      "1-liedown",
      "2-standup",
      "3-speak",
    ]);
  });

  test("loads a template folded and folds an unfinished row to its problem", async ({
    page,
  }) => {
    // Folded rows are what keep a twenty-step patrol on one screen. The two
    // rules worth pinning: a loaded template arrives as one-line summaries,
    // and every row folds — an unfinished one included — with the problem
    // standing in for its summary, so it is still findable when the operator
    // goes looking for why Save is greyed out.
    await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    // The MOVE row's only input is its waypoint picker.
    const waypoint = page.getByRole("combobox", { name: "Waypoint for step 1" });
    await expect(page.getByText(/^dock · \(/)).toBeVisible();
    await expect(waypoint).toHaveCount(0);

    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    const say = page.getByPlaceholder(/Delivery arrived/);
    await expect(say).toBeVisible();

    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(waypoint).toBeVisible();
    // Unfolded, a MOVE row is the picker alone: no coordinate fields.
    await expect(page.getByLabel(/^(X|Y|Orientation)\b/)).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse all" }).click();
    await expect(waypoint).toHaveCount(0);
    // Empty, and folded all the same: the header says what is missing.
    await expect(say).toHaveCount(0);
    const speakRow = page.getByRole("button", { name: /^Speak/, expanded: false });
    await expect(speakRow).toHaveText(/Needs something to say\./);

    // Unfold, fill, fold: the line is read back in place of the problem.
    await speakRow.click();
    await say.fill("Hello");
    await page.getByRole("button", { name: /^Speak/, expanded: true }).click();
    await expect(say).toHaveCount(0);
    await expect(page.getByText("“Hello”")).toBeVisible();
  });

  test("waits out a conversion before drawing the floor plan it produced", async ({
    page,
  }) => {
    // A raster read mid-conversion is the old plan or half of the new one, and
    // this cache never goes stale on its own, so it must not be read at all
    // until the catalogue says the conversion is over. A conversion another
    // console started looks exactly like this one.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const entry = mapSummary({ grid_status: "converting", grid_converting: true });
    await mockBackend(page, { maps: [entry] });
    const imageReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/image")) imageReads.push(pathname);
    });
    await page.goto("/tasks/editor");
    // The job's floor plan opens from the Steps header, with or without a
    // Move step on the list.
    await page.getByRole("button", { name: "Floor plan" }).click();
    await expect(page.getByRole("img", { name: /^Floor plan of dp2f/ })).toBeVisible();

    // Two catalogue polls' worth, while it still says converting.
    await page.waitForTimeout(4500);
    expect(imageReads).toEqual([]);

    entry.grid_status = "ok";
    entry.grid_converting = false;
    entry.modified_at = "2026-09-28T08:00:00Z";
    await expect
      .poll(() => imageReads, { timeout: 10_000 })
      .toEqual([`/api/v1/maps/${MAP_NAME}/image`]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("lights the waypoints the job's Move steps go to on the floor plan", async ({
    page,
  }) => {
    // A name in the picker is not a place. The floor plan used to open under
    // each Move row and pick for it; now the Steps group opens one for the
    // whole job, above the list, and what it adds is the route: the stops
    // the job goes to are lit and named with their step numbers, in the
    // words a screen reader hears too.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "GENERAL",
      x: -3,
      y: 4,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room] });
    await page.goto("/tasks/editor");

    // One button for the job, on the Steps header — none on the row.
    const toggle = page.getByRole("button", { name: "Floor plan" });
    await expect(toggle).toHaveCount(1);
    await page.getByTitle("Drive to a pose in the map frame.").click();
    await expect(toggle).toHaveCount(1);

    // Closed until asked for.
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f with 2 waypoints/ });
    await expect(plan).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(plan).toBeVisible();
    // Nothing picked yet, so nothing is lit.
    await expect(plan).toHaveAccessibleName(/waypoints\.$/);

    // The pick is made on the row, and the map says where it went.
    const waypoint = page.getByRole("combobox", { name: "Waypoint for step 1" });
    await waypoint.click();
    await page.getByRole("option", { name: "room-a" }).click();
    await expect(waypoint).toContainText("room-a");
    await expect(plan).toHaveAccessibleName(/; room-a is step 1\.$/);

    // A second Move to the dock: both stops, in job order.
    await page.getByTitle("Drive to a pose in the map frame.").click();
    const second = page.getByRole("combobox", { name: "Waypoint for step 2" });
    await second.click();
    await page.getByRole("option", { name: "dock" }).click();
    await expect(plan).toHaveAccessibleName(/; room-a is step 1, dock is step 2\.$/);

    // The map is a view: a click on it sets nothing on any row.
    const box = (await plan.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(waypoint).toContainText("room-a");
    await expect(second).toContainText("dock");
  });

  test("zooms the floor plan and comes back to fit", async ({ page }) => {
    // The fixed preview showed two stops a body length apart as one smear at
    // fit scale. The wheel, the two buttons and Fit are the desktop's way in
    // and out; nothing on screen prints the scale, so it is read off the
    // panel's data-zoom, the same way the editor's is.
    // A real grid, matching the catalogue's 400 x 300, so the raster has an
    // extent to zoom into.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto("/tasks/editor");
    await page.getByRole("button", { name: "Floor plan" }).click();
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

    // Zooming out never goes past where the map opened: that view already
    // has the whole floor plan on it, and smaller would only shrink it into
    // a corner.
    for (let i = 0; i < 6; i += 1) {
      await page.getByRole("button", { name: "Zoom out" }).click();
    }
    await expect.poll(readZoom).toBe(fitted);
  });
});

test.describe("the job history", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  const finished = [
    taskHistoryEntry(),
    taskHistoryEntry({
      id: "nightly-2026-09-18T01:00:00Z",
      run_id: "run-2",
      status: "FAILED",
      started_at: "2026-09-18T01:00:00Z",
      closed_at: "2026-09-18T01:12:30Z",
      source: "SCHEDULE",
      schedule_id: "nightly",
    }),
  ];

  test("lists each job by id, with who started it and how long it took", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    const listed = page.waitForRequest((request) =>
      request.url().includes("/api/v1/task_history"),
    );
    await page.goto("/history");
    // Ten a page, asked for explicitly rather than left to the backend's 20.
    expect(new URL((await listed).url()).searchParams.get("page_size")).toBe("10");

    await expect(page.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    // 09:40:00 → 09:44:12, measured between the backend's own timestamps.
    await expect(page.getByText("4:12", { exact: true })).toBeVisible();
    await expect(page.getByText("12:30", { exact: true })).toBeVisible();
    // Everything fits on one page, so there is nothing to page through.
    await expect(page.getByRole("navigation", { name: "History pages" })).toBeHidden();
  });

  test("asks the robot for failed jobs only when that filter is picked", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const filtered = page.waitForRequest(
      (request) =>
        request.url().includes("/api/v1/task_history") &&
        new URL(request.url()).searchParams.get("status") === "FAILED",
    );
    await page.getByRole("button", { name: "Failed", exact: true }).click();
    await filtered;

    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
  });

  test("pages forward with the cursor it was handed, and back without one", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished, taskHistoryPageSize: 1 });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Page 1")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();

    const next = page.waitForRequest(
      (request) =>
        new URL(request.url()).searchParams.get("page_token") === "1",
    );
    await page.getByRole("button", { name: "Next" }).click();
    await next;

    // Replaced, not appended: this is page two, and it is the last one.
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(page.getByText("Page 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();

    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Page 1")).toBeVisible();
  });

  test("opens a job from anywhere on its row, with the reason a step failed", async ({
    page,
  }) => {
    await mockBackend(page, {
      taskHistory: finished,
      taskStates: {
        "nightly-2026-09-18T01:00:00Z": {
          id: "nightly-2026-09-18T01:00:00Z",
          status: "FAILED",
          steps: [
            { id: "1-move", status: "COMPLETED", error_msg: "" },
            { id: "2-move", status: "FAILED", error_msg: "Goal is blocked." },
          ],
        },
      },
    });
    await page.goto("/history");

    const described = page.waitForRequest((request) =>
      new URL(request.url()).pathname.endsWith(
        `/api/v1/tasks/${encodeURIComponent("nightly-2026-09-18T01:00:00Z")}`,
      ),
    );
    await page.getByText("nightly-2026-09-18T01:00:00Z").click();
    await described;

    await expect(
      page.getByRole("button", { name: /nightly-2026-09-18T01:00:00Z/ }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("2-move")).toBeVisible();
    await expect(page.getByText("Goal is blocked.")).toBeVisible();
  });
});

test.describe("the job history when the robot cannot answer", () => {
  // No console-error guard here: the browser logs the 502 itself, which is
  // exactly the response under test.
  test("shows the backend's own sentence and a way to try again", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.route("**/api/v1/task_history**", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "List task history failed" }),
      }),
    );
    await page.goto("/history");

    await expect(page.getByText("List task history failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
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
    await expect(row.getByRole("button", { name: "Save schedule" })).toBeVisible();
  });
});
