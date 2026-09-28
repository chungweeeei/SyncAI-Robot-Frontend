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
    const body = writes[0].body as { name: string; topics: string[] };
    expect(body.name).toBe("field-run-3");
    expect(body.topics.length).toBeGreaterThan(0);
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
    // template, the renamed field, the unfolded composer) is as it was,
    // across a reload too.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await page.getByPlaceholder("Morning patrol").fill("night run");

    await page.getByRole("link", { name: "Add waypoints on the floor plan" }).click();
    await expect(page).toHaveURL(/\/maps\/dp2f\/edit\?mode=vertex&from=tasks$/);
    // Opened with Waypoint chosen to draw, not with nothing chosen as the
    // editor otherwise opens.
    await expect(page.getByRole("combobox", { name: "Draw" })).toContainText("Waypoint");

    await page.getByRole("button", { name: "Back to tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    const asLeft = async () => {
      await expect(page.getByText("Editing Morning round")).toBeVisible();
      await expect(page.getByText(/^dock · \(/)).toBeVisible();
      await expect(page.getByText("\u201cArrived\u201d")).toBeVisible();
      await expect(page.getByPlaceholder("Morning patrol")).toHaveValue("night run");
    };
    await asLeft();

    // A reload is the other way to lose the draft; the tab keeps it.
    await page.reload();
    await asLeft();

    // Stop editing empties it, and empty is what a reload then finds.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /Stop editing/ }).click();
    await expect(page.getByText("Editing Morning round")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Editing Morning round")).toHaveCount(0);
    await expect(page.getByText(/^dock · \(/)).toHaveCount(0);
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
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();
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
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toBeDisabled();
    await expect(
      page.getByText("This job is for wh1; the robot has dp2f loaded", { exact: false }).first(),
    ).toBeVisible();

    await page.getByPlaceholder("Morning patrol").fill("to bay");
    await page.getByRole("button", { name: "Save as new" }).click();

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

    await expect(page.getByText("Running outside this editor")).toBeVisible();
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

    test("lists registered schedules above the editor, in words", async ({
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

      // What the robot already does on its own sits with the library, above the
      // thing being drafted.
      const schedules = page.getByRole("heading", { name: "Registered schedules" });
      const editor = page.getByRole("button", { name: /Task editor/ });
      await expect(schedules).toBeVisible();
      const editorFollows = await schedules.evaluate(
        (heading, editorEl) =>
          Boolean(
            heading.compareDocumentPosition(editorEl as Node) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
        await editor.elementHandle(),
      );
      expect(editorFollows).toBe(true);
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

    await page.getByRole("button", { name: "Arm manual drive input" }).click();
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

    // Wall: its mark, then the paint tools.
    await choose(page, "Wall");
    await expect(page.getByRole("img", { name: "Drawing Wall" })).toBeVisible();
    await expect.poll(() => toolNames(page)).toEqual(["Pan", "Brush", "Line", "Rect"]);

    await choose(page, "Waypoint");
    await expect.poll(() => toolNames(page)).toEqual(["Pan", "Place", "Select"]);
    await expect(page.getByRole("combobox", { name: "Waypoint type" })).toBeVisible();

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

    // No type is an item of its own, and puts the choice down.
    await choose(page, "No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(page.getByRole("combobox", { name: "Waypoint type" })).toHaveCount(0);
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
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();

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

    await page.getByPlaceholder("Morning patrol").fill("reorder-check");
    await page.getByRole("button", { name: "Save as new" }).click();

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
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();
    await page.getByTitle("Drive to a pose in the map frame.").click();
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

  test("picks a waypoint by clicking it on the floor plan", async ({ page }) => {
    // A name in the picker is not a place. The floor plan beside it is drawn
    // in the same frame the map editor uses, so a click on a marker has to
    // land on the stop the editor placed there — and what the console then
    // saves has to be that stop's pose, not the one under the pointer.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "GENERAL",
      x: -3,
      y: 4,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room] });
    const saved: unknown[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      saved.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "33333333-3333-3333-3333-333333333333", name: "to room" }),
        ),
      });
    });
    await page.goto("/tasks");
    await page.getByRole("button", { name: /Task editor/ }).click();
    await page.getByTitle("Drive to a pose in the map frame.").click();

    // Closed until asked for: a map under every row would bury the list.
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f with 2 waypoints/ });
    await expect(plan).toHaveCount(0);
    const toggle = page.getByRole("button", { name: "Floor plan" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(plan).toBeVisible();
    await expect(plan).toHaveAccessibleName(/waypoints\.$/);

    // Where the marker is, from the mock's own geometry: the same fit-and-
    // centre the preview draws with (lib/map/preview.ts previewView, which is
    // fitView inside PREVIEW_INSET, then worldToGrid).
    const grid = mapSummary().grid;
    const box = (await plan.boundingBox())!;
    const inset = { top: 20, right: 48, bottom: 20, left: 20 };
    const innerW = box.width - inset.left - inset.right;
    const innerH = box.height - inset.top - inset.bottom;
    const scale = Math.min(innerW / grid.width, innerH / grid.height);
    const ox = inset.left + (innerW - grid.width * scale) / 2;
    const oy = inset.top + (innerH - grid.height * scale) / 2;
    const px = (room.x - grid.origin.x) / grid.resolution;
    const py = grid.height - (room.y - grid.origin.y) / grid.resolution;
    await page.mouse.click(box.x + ox + px * scale, box.y + oy + py * scale);

    // Both faces of the row agree on the pick, and the map says so too.
    await expect(
      page.getByRole("combobox", { name: "Waypoint for step 1" }),
    ).toContainText("room-a");
    await expect(plan).toHaveAccessibleName(/room-a is picked\.$/);
    await page.getByRole("button", { name: /^Move/, expanded: true }).click();
    await expect(page.getByText(/^room-a · \(/)).toBeVisible();

    await page.getByPlaceholder("Morning patrol").fill("to room");
    await page.getByRole("button", { name: "Save as new" }).click();

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as {
      steps: { id: string; vertex_id: string; params: { x: number; y: number } }[];
    };
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].id).toBe("1-move");
    expect(body.steps[0].vertex_id).toBe(room.id);
    expect(body.steps[0].params).toMatchObject({ x: -3, y: 4 });
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
