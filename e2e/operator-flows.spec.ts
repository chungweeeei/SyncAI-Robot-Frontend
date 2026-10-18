import { expect, test, type Locator, type Page } from "@playwright/test";

import { encodeOctomapBt } from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  floorPlanPng,
  mapSummary,
  mockBackend,
  recording,
  robotState,
  taskHistoryEntry,
  taskState,
  taskTemplate,
  TWO_FLOORS,
  vertex,
  withOctomap,
} from "./backend";

/**
 * The flows where a button does something to a real machine. Each asserts
 * what the screen says *and* what the console sent: a screen-only test passes
 * a build that posts to the wrong endpoint.
 */

test.describe("the recorder", () => {
  test("shows the idle form when nothing is recording", async ({ page }) => {
    // Which face is shown comes from the server, not from a local flag, so a
    // recording started from a shell is reflected correctly.
    await mockBackend(page, { activeRecording: null });
    await page.goto("/recordings");

    await expect(
      page.getByRole("button", { name: /start recording/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  });

  test("shows the live face and the robot's own elapsed clock", async ({
    page,
  }) => {
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
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
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
    // The scanner pair a map is rebuilt from; the camera is opt-in.
    // Relative names: the backend expands them under the robot's namespace.
    expect(body.topics).toEqual(["livox/lidar", "livox/imu"]);
    // Compressed unless the operator turns it off.
    expect(body.compression).toBe(true);
  });

  test("refuses the reserved name before a request goes out", async ({
    page,
  }) => {
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
    // The running map cannot be renamed or deleted, and the card says so
    // rather than leaving it to a 409. Its floor plan stays editable while the
    // robot is idle: the backend saves onto the live map and reloads it.
    await mockBackend(page, { maps: [mapSummary({ active: true })] });
    await page.goto("/maps");

    await expect(page.getByRole("heading", { name: MAP_NAME })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Delete ${MAP_NAME}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: `Rename ${MAP_NAME}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: `Edit ${MAP_NAME}` }),
    ).toHaveAttribute("href", `/maps/${MAP_NAME}/edit`);
  });

  test("holds Edit on the map in use while a job drives on it", async ({
    page,
  }) => {
    await mockBackend(page, {
      maps: [mapSummary({ active: true })],
      activeTasks: [activeTask()],
    });
    await page.goto("/maps");

    await expect(
      page.locator(
        'span[aria-disabled="true"]:not([role])[title^="The robot is running a job on this map"]',
      ),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(
      page.getByRole("link", { name: `Edit ${MAP_NAME}` }),
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

  test("sends the delete only after the dialog is confirmed", async ({
    page,
  }) => {
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

  test("exports a map as a zip named after it", async ({ page }) => {
    await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site" }),
      ],
    });
    await page.goto("/maps");

    // The console names the file (Content-Disposition is not CORS-exposed),
    // so watching only the request would pass a build that saved "blob".
    const requested = page.waitForRequest(
      /\/api\/v1\/maps\/old-site\/export\?format=zip$/,
    );
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export old-site" }).click();

    expect((await requested).method()).toBe("GET");
    expect((await downloaded).suggestedFilename()).toBe("old-site.zip");
  });

  test("imports an archive under the name on the file", async ({ page }) => {
    const writes = await mockBackend(page, {
      maps: [mapSummary({ active: true, name: "in-use" })],
    });
    await page.goto("/maps");

    await page.getByLabel("Map archive").setInputFiles({
      name: "site-b.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\x05\x06", "latin1"),
    });

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    // Pre-filled from the filename, which is what an export is called.
    await expect(dialog.getByLabel("Save as")).toHaveValue("site-b");

    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/v1/maps/import"),
    );
    await dialog.getByRole("button", { name: "Import" }).click();

    // The body is the archive itself, not a multipart form — the backend has
    // no parser for one — and the name travels in the query.
    const request = await sent;
    expect(new URL(request.url()).searchParams.get("name")).toBe("site-b");
    expect(request.headers()["content-type"]).toBe("application/octet-stream");
    // Polled: the request event this test awaited fires as the request is
    // issued, and the route handler that logs it is not ordered before it.
    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);

    // The backend's sentence above the grid, and the refetch mounts the card.
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 'site-b'" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "site-b" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("cancels an upload still in flight, then imports on the second try", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      maps: [mapSummary({ active: true, name: "in-use" })],
    });
    // Registered after mockBackend so it wins: the robot never answers this
    // upload, which is the state a Cancel exists for.
    let release = () => {};
    await page.route("**/api/v1/maps/import**", async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      // By now the browser has dropped the request; the route may already
      // be gone with it.
      await route.abort().catch(() => undefined);
    });
    await page.goto("/maps");

    const archive = {
      name: "site-b.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\x05\x06", "latin1"),
    };
    await page.getByLabel("Map archive").setInputFiles(archive);
    const dialog = page.getByRole("alertdialog");

    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/api/v1/maps/import"),
    );
    await dialog.getByRole("button", { name: "Import" }).click();
    // Positive control: the upload is really in flight before it is cancelled.
    await sent;
    await expect(dialog.getByRole("button", { name: "Importing…" })).toBeDisabled();

    // The other half of the assertion is the network's: an abort the console
    // only pretended to do leaves the request pending, and this never fires.
    const failed = page.waitForEvent(
      "requestfailed",
      (request) => request.url().includes("/api/v1/maps/import"),
    );
    await dialog.getByRole("button", { name: "Cancel upload" }).click();
    expect((await failed).failure()?.errorText).toBe("net::ERR_ABORTED");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Import canceled." }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "site-b" })).toHaveCount(0);

    // A cancel must not poison the next attempt: the fake answers this one.
    await page.unroute("**/api/v1/maps/import**");
    release();
    await page.getByLabel("Map archive").setInputFiles(archive);
    await dialog.getByRole("button", { name: "Import" }).click();
    await expect
      .poll(() => writes.filter((w) => w.method === "POST"))
      .toHaveLength(1);
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 'site-b'" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "site-b" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("warns before an import that would replace a map", async ({ page }) => {
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "in-use" }),
        mapSummary({ active: false, name: "old-site" }),
      ],
    });
    await page.goto("/maps");

    await page.getByLabel("Map archive").setInputFiles({
      name: "old-site.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\x05\x06", "latin1"),
    });

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("replaces it and its waypoints");
    // The confirm names the consequence; "Import" would read as additive.
    await expect(dialog.getByRole("button", { name: "Replace" })).toBeVisible();

    // Backing out sends nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes.filter((w) => w.method === "POST")).toHaveLength(0);
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

  test("places a waypoint on the ground floor whatever floor is shown", async ({ page }) => {
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
    // Placing on an upper floor is not offered yet: 2F is only on show.
    expect(draft.z).toBe(0);
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

  test("names the waypoint field and the editor in the operator's words", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await expect(page.getByRole("toolbar", { name: "Draw" })).toBeVisible();
    await expect(page.getByText(/gridmap|vertices/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Place" }).click();
    const canvas = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
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
      page.getByText(
        `"${MAP_NAME}" has no floor plan yet. Build one from the map's card`,
      ),
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
    expect(asked).toMatch(/unsaved changes/);
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

  test("does not ask about a saved job opened and left as it was", async ({ page }) => {
    // A loaded job is only unsaved once it differs from its row: a needless
    // prompt teaches the operator to press OK through the one that matters.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    await page.getByRole("button", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    const asked: string[] = [];
    page.on("dialog", (dialog) => {
      asked.push(dialog.message());
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
    expect(asked).toEqual([]);
  });

  test("asks before the tab closes on unsaved work, and only then", async ({ page }) => {
    // The draft survives a trip to another screen but not the tab. Positive
    // control first: an untouched saved job closes without a question.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();

    const kinds: string[] = [];
    page.on("dialog", (dialog) => {
      kinds.push(dialog.type());
      void dialog.dismiss();
    });
    // Chromium only honours beforeunload on a page the user has touched.
    await page.getByText(/^Steps run in order/).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    expect(kinds).toEqual([]);
    // Waited for through the rows, so the library has answered by the time
    // the chip's absence is read.
    await expect(page.getByText(/^dock · \(/)).toBeVisible();
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => kinds).toEqual(["beforeunload"]);
  });

  test("counts a job's paused schedules, and points at them in the list", async ({
    page,
  }) => {
    // Three schedules, two paused: the chip must show the pauses, not leave
    // them to a hover title a finger never sees.
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
        {
          id: "other",
          trigger: { interval_seconds: 3600 },
          paused: false,
          next_run_times: [],
        },
        linked("weekend", true),
        linked("holiday", true),
      ],
    });
    await page.goto("/tasks");

    const chip = page.getByRole("button", {
      name: /^Show the schedules for "Morning round"/,
    });
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

  test("lists another map's jobs, marked and not runnable", async ({
    page,
  }) => {
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
    await expect(
      page.getByText("Saved for wh1; the robot has dp2f loaded."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: 'Dispatch "Second floor" now' }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: 'Schedule "Second floor"' }),
    ).toBeDisabled();
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
    // Adding a missing waypoint mid-job must not throw the job away: the link
    // opens that map's editor in Waypoints mode, back returns here, and the
    // draft is as it was, across a reload too.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");

    await page
      .getByRole("link", { name: "Add waypoints on the floor plan" })
      .click();
    await expect(page).toHaveURL(/\/maps\/dp2f\/edit\?mode=vertex&from=tasks$/);
    // Opened with Waypoint chosen to draw, not with nothing chosen as the
    // editor otherwise opens.
    await expect(page.getByRole("combobox", { name: "Draw" })).toContainText(
      "Waypoint",
    );

    await page.getByRole("button", { name: "Back to tasks" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const asLeft = async () => {
      await expect(
        page.getByRole("heading", { name: "Morning round" }),
      ).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: "Morning round" }),
    ).toHaveCount(0);
    await expect(page.getByText(/^dock · \(/)).toHaveCount(0);
  });

  test("saves over the loaded job, and leaves for Tasks after a new one", async ({
    page,
  }) => {
    // One Save: a loaded template is updated in place, never copied, and
    // stays open; a job saved for the first time returns to /tasks with the
    // draft emptied, so Create task does not ask about a job already a row.
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
          taskTemplate({
            id: method === "POST" ? created : loaded,
            name: body.name,
          }),
        ),
      });
    });

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => writes)
      .toEqual([{ method: "PUT", path: `/api/v1/task_templates/${loaded}` }]);
    // The page does not move on an update, so a card says it landed.
    const notice = page.getByRole("status").filter({ hasText: "Saved Morning round" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Dismiss" }).click();
    await expect(notice).toBeHidden();

    // A fresh job: created once, then updated. The loaded one is still in
    // the draft, so Create task asks first.
    await page.goto("/tasks");
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    const save = page.getByRole("button", { name: "Save", exact: true });
    // No name yet: Save sends nothing and points at the name field, and
    // Enter there is the same Save.
    const field = page.getByRole("textbox", { name: "Task name" });
    await save.click();
    await expect(field).toBeFocused();
    await expect(page.getByText("Name this task to save it.")).toBeVisible();
    expect(writes).toHaveLength(1);
    await field.fill("greeting");
    await expect(page.getByText("Name this task to save it.")).toHaveCount(0);
    // Nothing in the editor runs the robot.
    await expect(page.getByRole("button", { name: "Dispatch" })).toHaveCount(0);
    await expect(
      page.getByRole("radiogroup", { name: "When to run" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Create schedule" }),
    ).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect
      .poll(() => writes.slice(1))
      .toEqual([{ method: "POST", path: "/api/v1/task_templates" }]);
    // A create says so before it leaves, and only the button leaves.
    const saved = page.getByRole("alertdialog");
    await expect(saved).toContainText("Saved");
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await saved.getByRole("button", { name: "Go to Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);

    // The draft went with the save: Create task opens a blank editor without
    // asking first.
    let asked = false;
    page.once("dialog", (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    expect(asked).toBe(false);
    expect(writes).toHaveLength(2);
  });

  test("names a new job in the heading and saves it in one press", async ({
    page,
  }) => {
    // The name is typed straight into the heading, and Save sends it with
    // the steps.
    await mockBackend(page);
    const posted: { name: string; steps: unknown[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: unknown[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "44444444-4444-4444-4444-444444444444", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arrived");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.name).toBe("greeting");
    expect(posted[0]!.steps).toHaveLength(1);
    await expect(page.getByRole("alertdialog")).toContainText("Saved greeting");
    await page.getByRole("button", { name: "Go to Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
  });

  test("saves a Speak said more than once with its count", async ({ page }) => {
    // Both halves: the count on screen, and the count in the body. A line
    // said once sends none, so a save from before the field is unchanged.
    await mockBackend(page);
    const posted: { steps: { params?: Record<string, unknown> }[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: [] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "66666666-6666-6666-6666-666666666666", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    const times = page.getByRole("textbox", { name: "Times" });
    await expect(times).toHaveValue("1");

    await times.fill("51");
    await expect(page.getByText("Say it 1 to 50 times.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

    await times.fill("3");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps[0]!.params).toEqual({ text: "Arriving", repeat: 3 });
  });

  test("saves steps boxed together as one group", async ({ page }) => {
    // The robot starts a group's steps together; the seam between two rows is
    // how an operator says so, and the wire has to carry it as a shared name.
    await mockBackend(page);
    const posted: { steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: Record<string, unknown>[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "55555555-5555-5555-5555-555555555555", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    await page.getByTitle("Stand up. Nothing to set.").click();
    await page.getByTitle("Stay put for a set time, then go on.").click();
    await page.getByRole("textbox", { name: "Duration" }).fill("5");

    // A seam in each gap and none above the first row, which has nothing to
    // run with.
    await expect(page.getByRole("button", { name: /^(Start together|Split here):/ })).toHaveCount(2);
    const seam = page.getByRole("button", { name: "Start together: step 1 and step 2" });
    await expect(page.getByRole("button", { name: /^Ungroup/ })).toHaveCount(0);
    await seam.click();
    // The pair is one box now, and the seam between them offers to split it.
    await expect(page.getByRole("button", { name: "Ungroup steps 1 to 2" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Split here: run step 2 after step 1" }),
    ).toBeFocused();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.steps.map((step) => [step.id, step.group])).toEqual([
      ["1-speak", "g1"],
      ["2-standup", "g1"],
      ["3-wait", undefined],
    ]);
  });

  test("refuses to start two body steps together, and says why", async ({ page }) => {
    // The robot has one body, so the editor never builds the group the
    // backend would refuse: the seam stays, says why, and does nothing.
    const writes = await mockBackend(page);
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("bow");
    await page.getByTitle("Stand up. Nothing to set.").click();
    await page.getByTitle("Lie down. Nothing to set.").click();
    const save = page.getByRole("button", { name: "Save", exact: true });

    const seam = page.getByRole("button", { name: /^Can't start together: step 1 and step 2/ });
    await expect(seam).toHaveAttribute("aria-disabled", "true");
    // Forced: the seam is aria-disabled, and what it does when pressed anyway
    // is what is under test.
    await seam.click({ force: true });
    await expect(page.getByRole("button", { name: /^Ungroup/ })).toHaveCount(0);
    await expect(save).toBeEnabled();

    // The row's menu, a finger's way to the same link, refuses it too.
    await page.getByRole("button", { name: "More actions for step 2" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Start together with step 1" }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText(/one Move, Dock, Stand or Lie at a time/)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("marks the row a refused save names, in the backend's words", async ({ page }) => {
    // For a rule the editor does not mirror: the backend names the step,
    // and the row it was sent from carries the sentence.
    await mockBackend(page);
    const refusal = "Step '2-speak' cannot run here.";
    const posted: { steps: { id: string }[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      posted.push(route.request().postDataJSON() as { steps: { id: string }[] });
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: refusal, code: "invalid_step_group", step_id: "2-speak" }),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("greeting");
    await page.getByTitle("Stay put for a set time, then go on.").click();
    await page.getByRole("textbox", { name: "Duration" }).fill("5");
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).fill("Arriving");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => posted.map((body) => body.steps.map((step) => step.id))).toEqual([
      ["1-wait", "2-speak"],
    ]);
    const rows = page.getByRole("list").first().getByRole("listitem");
    await expect(rows.nth(1)).toContainText(refusal);
    await expect(rows.nth(0)).not.toContainText(refusal);
    // Still in the heading too: the row says where, the heading says it happened.
    await expect(page.locator("header").getByRole("alert").filter({ hasText: refusal })).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    // The 400 is the behaviour under test; Chromium logs every refusal it fetches.
    errors = errors.filter((text) => !/status of 400/.test(text));
  });

  test("loads a saved group back as a box, and Ungroup takes it apart", async ({ page }) => {
    const speakStep = (id: string, text: string) => ({
      id,
      vertex_id: null,
      vertex_name: null,
      vertex_status: "NONE",
      group: "g1",
      type: "SPEAK",
      params: { text },
      resolved_params: { text },
    });
    await mockBackend(page, {
      templates: [
        taskTemplate({
          map_name: null,
          steps: [speakStep("1-speak", "Hello"), speakStep("2-speak", "World")],
        }),
      ],
    });
    await page.goto("/tasks");
    // The library row shows the pair as one bracket.
    await expect(page.getByText("[T T]")).toBeVisible();
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page.getByRole("heading", { name: "Morning round" })).toBeVisible();
    const ungroup = page.getByRole("button", { name: "Ungroup steps 1 to 2" });
    await expect(ungroup).toBeVisible();
    // Opened and left as it was: nothing to save.
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);

    // The header goes with the box, so focus lands on the seam that would put
    // it back rather than falling to the page.
    await ungroup.click();
    await expect(ungroup).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start together: step 1 and step 2" }),
    ).toBeFocused();
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("renames a saved job through Save, and Escape backs out", async ({
    page,
  }) => {
    // A rename is a Save like any other edit: the name goes with the steps,
    // so a step edit made beside it is saved with it rather than left behind.
    const template = "22222222-2222-2222-2222-222222222222";
    await mockBackend(page);
    const puts: { name: string; steps: unknown[] }[] = [];
    await page.route(`**/api/v1/task_templates/${template}`, (route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      const body = route.request().postDataJSON() as { name: string; steps: unknown[] };
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
    await page.getByTitle("Say a line on the robot speaker (TTS).").click();
    await page.getByPlaceholder(/Delivery arrived/).last().fill("Evening");

    const field = page.getByRole("textbox", { name: "Task name" });
    await expect(field).toHaveValue("Morning round");
    await field.fill("Evening round");
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("Morning round");
    expect(puts).toEqual([]);

    await field.fill("Evening round");
    await page.keyboard.press("Enter");
    await expect.poll(() => puts).toHaveLength(1);
    expect(puts[0]!.name).toBe("Evening round");
    // The step added beside the rename went with it.
    expect(puts[0]!.steps).toContainEqual(
      expect.objectContaining({ type: "SPEAK", params: { text: "Evening" } }),
    );
    await expect(
      page.getByRole("heading", { name: "Evening round" }),
    ).toBeAttached();
  });

  test("deletes the loaded job only once confirmed, and leaves", async ({
    page,
  }) => {
    // Delete sits beside Save, so a kept dialog must send nothing; and the
    // dialog names the schedules that will outlive the job, since each
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
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toHaveCount(0);

    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    const remove = page.getByRole("button", { name: "Delete", exact: true });

    await remove.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Delete Morning round?");
    await expect(dialog).toContainText("Its schedule keeps running");
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/tasks\/editor$/);
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

    await remove.click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    expect(
      writes.filter((w) => w.method === "DELETE").map((w) => w.path),
    ).toEqual([`/api/v1/task_templates/${template}`]);
    // The draft went with it: the editor opens empty.
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
  });

  test("authors a job for a map the robot is not on", async ({ page }) => {
    // A job built for another map: the picker lists only that map's
    // waypoints, the saved body names that map, and the run button stays
    // held because the robot is not there.
    const bay = vertex({
      id: "66666666-6666-6666-6666-666666666666",
      name: "bay-1",
      type: "MOVE",
      map_name: "wh1",
      x: 1,
      y: 2,
      theta: 0,
    });
    await mockBackend(page, {
      maps: [
        mapSummary(),
        mapSummary({ name: "wh1", active: false, vertex_count: 1 }),
      ],
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

    const waypoint = page.getByRole("combobox", {
      name: "Waypoint for step 1",
    });
    await waypoint.click();
    await expect(page.getByRole("option", { name: "bay-1" })).toBeVisible();
    await expect(page.getByRole("option", { name: "dock" })).toHaveCount(0);
    await page.getByRole("option", { name: "bay-1" }).click();
    await expect(waypoint).toContainText("bay-1");

    // Held, with the reason, until that map is the loaded one.
    await expect(
      page
        .getByText("This job is for wh1; the robot has dp2f loaded", {
          exact: false,
        })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("textbox", { name: "Task name" }).fill("to bay");
    await page.keyboard.press("Enter");

    await expect.poll(() => saved).toHaveLength(1);
    const body = saved[0] as {
      map_name: string;
      steps: { vertex_id: string }[];
    };
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

    // Scoped past the masthead: its bar names the running job's id too, so a
    // page-wide locator would match both and prove neither.
    const banner = page.locator("main");
    await expect(banner.getByText("Running outside this page")).toBeVisible();
    await expect(banner.getByText("robot01-task-1758000000-1")).toBeVisible();
    await expect(banner.getByText("via nightly")).toBeVisible();
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

    // The banner's own button: the masthead carries a second Cancel for the
    // same run (see run-controls.spec.ts), and this test is about the banner.
    await page
      .getByRole("main")
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect
      .poll(() => writes.filter((w) => w.method === "DELETE"))
      .toHaveLength(1);
    expect(writes[0].path).toBe("/api/v1/tasks/robot01-task-1758000000-1");
  });

  test("registers a timed schedule as a cron the operator never typed", async ({
    page,
  }) => {
    // The console writes the trigger's cron from a clock time and weekdays;
    // the string is what the scheduler acts on and a screen cannot show.
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Schedule "Morning round"' })
      .click();
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
    // A screen-only test would pass a build that registers "every 30 seconds"
    // for "every 30 minutes".
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Schedule "Morning round"' })
      .click();
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
      // The edit is a PATCH of the trigger alone: a delete and re-create
      // would lose the name and a pause, and still pass on screen.
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
      await expect(page.getByPlaceholder("robot01-daily-patrol")).toHaveCount(
        0,
      );
      const save = page.getByRole("button", { name: "Save schedule" });
      await expect(save).toBeDisabled();

      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByLabel("Time").fill("10:30");
      await save.click();

      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({
        method: "PATCH",
        path: "/api/v1/schedules/nightly",
        body: {
          trigger: { cron: "30 10 * * 1,2,3,4,5", timezone: "Asia/Taipei" },
        },
      });
      await expect(page.getByText("Edit nightly")).toHaveCount(0);
      await expect(
        page.getByText("Weekdays at 10:30 · Asia/Taipei"),
      ).toBeVisible();
      // Still the same schedule, still paused.
      await expect(page.getByText("nightly", { exact: true })).toBeVisible();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    });

    /**
     * The robot's schedule list trails a write by a second or two, so the
     * first two reads after it answer the old list; the new row must still
     * appear without a Refresh.
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
        if (request.method() === "POST" && path.endsWith("/schedule"))
          registered = true;
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
      await expect(
        page.getByText("No schedules are registered on this robot."),
      ).toBeVisible();

      await page
        .getByRole("button", { name: 'Schedule "Morning round"' })
        .click();
      await page
        .getByPlaceholder("robot01-daily-patrol")
        .fill("weekday-patrol");
      await page.getByRole("button", { name: "Weekdays" }).click();
      await page.getByRole("button", { name: "Create schedule" }).click();

      const row = page
        .getByRole("listitem")
        .filter({ hasText: "weekday-patrol" });
      await expect(
        row.getByText("Weekdays at 09:00 · Asia/Taipei"),
      ).toBeVisible();
      await expect(
        row.getByText("2099-01-01 09:00", { exact: true }),
      ).toBeVisible();
      expect(staleReads).toBe(2);
      // The job's own chip reads the same list, so it catches up with it.
      await expect(
        page.getByRole("button", {
          name: /^Show the schedules for "Morning round"/,
        }),
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
      await expect(
        page.getByText("Daily at 10:30 · Asia/Taipei"),
      ).toBeVisible();
      await expect(
        page.getByText("2099-01-01 10:30", { exact: true }),
      ).toBeVisible();
      expect(staleReads).toBe(2);
      // The stale reads never reached the row.
      await expect(page.getByText("Daily at 21:00 · Asia/Taipei")).toHaveCount(
        0,
      );
    });

    test("lists registered schedules in words", async ({ page }) => {
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
      await expect(
        page.getByText("Daily at 21:00 · Asia/Taipei"),
      ).toBeVisible();
      await expect(page.getByText("0 21 * * *")).toHaveCount(0);

      // 13:00Z is 21:00 on the operator's clock, and that is the number shown;
      // UTC would make a correct schedule look wrong.
      await expect(
        page.getByText("2026-09-24 21:00", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("UTC", { exact: true })).toHaveCount(0);
    });

    test("re-reads the list once the soonest run has passed, and only then", async ({
      page,
    }) => {
      // The list is not polled; the soonest run time sets one read. The first
      // answer has a run a moment away and the second the recomputed time, so
      // the row moving proves the read happened.
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
  test("keeps the card at desktop width, with no way to the phone's drive view", async ({
    page,
  }) => {
    // The full-screen view is for thumbs; a mouse drives the card. The
    // positive control is the panel itself being open.
    await mockBackend(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await expect(page.getByRole("heading", { name: "Manual drive" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Translation stick" })).toHaveCSS("width", "96px");
    await expect(
      page.getByRole("link", { name: "Open the full-screen drive view" }),
    ).toBeHidden();
  });

  test("stands the robot up from any screen, without arming", async ({
    page,
  }) => {
    // The panel's Stand works from a screen with no viewport; the arm switch
    // is the sticks' and stays off.
    const writes = await mockBackend(page);
    const postures = () =>
      writes
        .filter((w) => w.path === "/api/v1/tasks")
        .map((w) => (w.body as { kind: string }).kind);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await expect(
      page.getByRole("switch", { name: "Arm manual drive input" }),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Stand", exact: true }).click();
    await expect.poll(postures).toEqual(["standup"]);
  });

  test("limits translation to the Max speed it shows, and never rotation", async ({
    page,
  }) => {
    // The slider's number must be the one the teleop frames carry; the wire
    // is the only place the scaled value shows. Keys always deflect fully, so
    // the limit is the only slow drive from the keys.
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
    // Full on every page load, before anything is armed.
    await expect(speed).toHaveAttribute(
      "aria-valuetext",
      "100 percent of full speed",
    );
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
    for (let step = 0; step < 5; step += 1)
      await page.keyboard.press("ArrowLeft");
    await expect(speed).toHaveAttribute(
      "aria-valuetext",
      "50 percent of full speed",
    );
    await expect.poll(last).toEqual({ vx: 0.5, vy: 0, wz: -1 });
    await expect(page.getByText("50%", { exact: true })).toBeVisible();

    await page.keyboard.up("w");
    await page.keyboard.up("d");
    await expect.poll(last).toEqual({ vx: 0, vy: 0, wz: 0 });

    // A key pressed while the slider has focus drives too: its thumb is an
    // <input>, which must not be taken for a text field.
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
      .evaluateAll((buttons) =>
        buttons.map((b) => b.getAttribute("aria-label")),
      );

  test("opens with no type, and offers the tools each type allows", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit`);

    // No type: Pan alone, lit, and no panel.
    await expect(drawList(page)).toContainText("No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(
      page.getByRole("button", { name: "Pan", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // Wall: the paint tools, and nothing in the row that is not a tool.
    await choose(page, "Wall");
    await expect(drawList(page)).toContainText("Wall");
    await expect
      .poll(() => toolNames(page))
      .toEqual(["Pan", "Brush", "Line", "Rect"]);

    await choose(page, "Waypoint");
    await expect
      .poll(() => toolNames(page))
      .toEqual(["Pan", "Place", "Select"]);
    await expect(
      page.getByRole("combobox", { name: "Waypoint type" }),
    ).toBeVisible();

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
    await expect(
      page.getByRole("button", { name: "Delete waypoint" }),
    ).toBeVisible();
    // The form puts the name and the type on one row, the type as a list.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("dock");
    await expect(page.getByRole("combobox", { name: "Type" })).toContainText(
      "Charger",
    );
    // Editing one waypoint shows that one only: the list is not under the form.
    await expect(page.getByRole("button", { name: /dock/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete waypoint" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Waypoint type" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /dock/ })).toBeVisible();

    // Forbidden zone: Shape and Done, and until Shape is armed the map dims
    // behind a line that asks for it. Done has nothing to close yet.
    await choose(page, "Forbidden zone");
    await expect
      .poll(() => toolNames(page))
      .toEqual(["Pan", "Shape", "Done", "Remove"]);
    const hint = page
      .getByRole("status")
      .filter({ hasText: "Select the shape to work with" });
    await expect(hint).toBeVisible();
    await expect(page.getByRole("button", { name: "Done" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove" })).toBeDisabled();
    await page.getByRole("button", { name: "Shape" }).click();
    await expect(hint).toHaveCount(0);

    // No type is an item of its own, and puts the choice down.
    await choose(page, "No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(
      page.getByRole("combobox", { name: "Waypoint type" }),
    ).toHaveCount(0);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("draws a forbidden zone from three corners, and closes it on the first", async ({
    page,
  }) => {
    // The finished-zone count is read off data-zones (the shape has to
    // *close*). Every corner is at least 22 px from the first, so a click on
    // it is a new corner, not a close.
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

    // The next shapes are 30 px to either side: a shape started on a
    // finished zone's corner anchors to it (see the growing test below). All
    // three still overlap at `inside`.
    const shifted = (dx: number) =>
      corners.map((corner) => ({ x: corner.x + dx, y: corner.y }));

    // Enter closes the next one.
    for (const corner of shifted(30))
      await page.mouse.click(corner.x, corner.y);
    await expect(done).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(zones).toHaveAttribute("data-zones", "2");

    // Done closes the one after that.
    for (const corner of shifted(-30))
      await page.mouse.click(corner.x, corner.y);
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
    await expect(page.getByRole("button", { name: "Shape" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(drawList(page)).toContainText("No type");
    await expect.poll(() => toolNames(page)).toEqual(["Pan"]);
    await expect(zones).toHaveAttribute("data-zones", "1");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("selects several zones with Shift and removes them together", async ({
    page,
  }) => {
    // Three overlapping zones, each with a spot only it covers. Shift-click
    // toggles selection; on bare map it keeps the selection instead of
    // starting a shape; Remove takes every selected zone. Which went is read
    // back through which spots still select.
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
      for (const corner of [...corners, corners[0]])
        await page.mouse.click(corner.x, corner.y);
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

  test("moves a corner of the shape in flight by dragging it, without panning", async ({
    page,
  }) => {
    // The canvas exposes no corners, so the move is proved by the close
    // rule: drag the first corner 80 px left, then a click at the old spot is
    // a new corner and one at the new spot closes. The Cell readout under a
    // fixed point rules out a pan.
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
          text = ((await cellReadout.textContent()) ?? "")
            .replace("Cell", "")
            .trim();
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

    // A selected finished zone reshapes the same way. Drag corner B 200 px
    // down so a point just inside the top edge falls outside: a click there
    // then starts a corner (Remove off, Escape drops it) instead of selecting.
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
    expect(await cellUnder(probe), "the handle drag panned the map").toBe(
      before,
    );
    await page.mouse.click(inside.x, inside.y);
    await expect(remove).toBeDisabled();
    await expect(done).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(zones).toHaveAttribute("data-zones", "1");
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("grows a finished zone from one of its corners to another", async ({
    page,
  }) => {
    // A square, then a bump off its right edge (B, two corners out, C): still
    // one zone, and a point in the bump goes from bare map to inside.
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
    for (const corner of [a, b, c, d, a])
      await page.mouse.click(corner.x, corner.y);
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

  test("holds Save while a job drives on the map, and saves the strokes once it ends", async ({
    page,
  }) => {
    // A job can start after the editor opened, so it checks for itself — and
    // keeps the strokes, saving them once the job ends.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const running = [activeTask()];
    await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      activeTasks: running,
    });
    // Counted here: this route answers the PUT before the fake's log sees it.
    let puts = 0;
    await page.route(/\/api\/v1\/maps\/[^/]+\/grid$/, (route, request) =>
      request.method() === "PUT" && ++puts
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              name: MAP_NAME,
              etag: "e2e",
              active: true,
              reloaded: true,
              message: "Saved and reloaded.",
            }),
          })
        : route.fallback(),
    );
    await page.goto(`/maps/${MAP_NAME}/edit`);
    const canvas = page.locator("canvas");
    await canvas.waitFor();
    await expect(
      page.getByRole("status").filter({ hasText: "Read-only." }),
    ).toBeVisible();

    await choose(page, "Wall");
    await page.getByRole("button", { name: "Brush" }).click();
    const box = (await canvas.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.6;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y, { steps: 4 });
    await page.mouse.up();

    const save = page.getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    expect(puts).toBe(0);

    running.length = 0;
    await expect(
      page.getByRole("status").filter({ hasText: "Read-only." }),
    ).toHaveCount(0);
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => puts).toBe(1);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("paints Wall as obstacle cells, and saves them", async ({ page }) => {
    // A Wall stroke must reach the robot as the obstacle byte: a swapped
    // Wall / Floor mapping would pass a screen-only test.
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

  test("opens with the map's saved zones, and Save sends a new one beside them", async ({
    page,
  }) => {
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
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Forbidden zones saved · in force now" }),
    ).toBeVisible();
    await expect(save).toBeDisabled();

    // The whole list, the saved zone first and untouched, the new one under
    // an id of its own — the robot refuses a list that repeats one.
    const puts = writes.filter((w) => w.method === "PUT");
    expect(puts.map((w) => w.path)).toEqual([
      `/api/v1/maps/${MAP_NAME}/keepout`,
    ]);
    const body = puts[0].body as {
      zones: { id: string; points: { x: number; y: number }[] }[];
    };
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

  /**
   * With the rail open, the cell readout covers the saved zone's corner;
   * folding gives back the width. Done before drawing, while still fitted.
   */
  const foldRail = async (page: Page) => {
    await page.getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand the sidebar" })).toBeVisible();
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

  test("Remove takes a zone off the robot at once, and leaves unsaved ones for Save", async ({
    page,
  }) => {
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
    await foldRail(page);
    const zones = page.locator("[data-zones]");
    const save = page.getByRole("button", { name: "Save" });
    const keepoutPuts = () =>
      writes.filter((w) => w.path.endsWith("/keepout")).map((w) => w.body);
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
    await expect(
      page.getByRole("status").filter({ hasText: /^Removed/ }),
    ).toBeVisible();
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

  test("removing a zone the robot never had sends nothing", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
    });
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
  test("puts a zone back when the robot refuses to remove it", async ({
    page,
  }) => {
    await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      keepout: { [MAP_NAME]: [saved] },
    });
    const refusal =
      "A floor plan rebuild is running; save the forbidden zones once it has finished.";
    await page.route(/\/api\/v1\/maps\/[^/]+\/keepout$/, (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              detail: refusal,
              code: "conversion_running",
            }),
          })
        : route.fallback(),
    );
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();
    await foldRail(page);
    const zones = page.locator("[data-zones]");
    await expect(zones).toHaveAttribute("data-zones", "1");

    await choose(page, "Forbidden zone");
    await page.getByRole("button", { name: "Shape" }).click();
    const middle = await savedZoneMiddle(page);
    await page.mouse.click(middle.x, middle.y);
    await page.getByRole("button", { name: "Remove" }).click();

    // The planner still keeps to it, so the map shows it again, clean.
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Forbidden zone not removed" });
    await expect(alert).toContainText(refusal);
    await expect(zones).toHaveAttribute("data-zones", "1");
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  // No console-error guard here: the browser logs the 502 itself, which is
  // exactly the response under test.
  test("locks the zones, and leaves the floor plan editable, when they cannot be read", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
    });
    await page.route(/\/api\/v1\/maps\/[^/]+\/keepout$/, (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "The map's forbidden zones could not be read.",
        }),
      }),
    );
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await page.locator("canvas").waitFor();

    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Forbidden zones could not be loaded" });
    // The backend's own sentence under the headline, verbatim.
    await expect(alert).toContainText(
      "The map's forbidden zones could not be read.",
    );
    await page.getByRole("combobox", { name: "Draw" }).click();
    await expect(
      page.getByRole("option", { name: "Forbidden zone", exact: true }),
    ).toHaveAttribute("aria-disabled", "true");
    // The positive control: the rest of the list still works.
    await page.getByRole("option", { name: "Wall", exact: true }).click();
    await expect(page.getByRole("button", { name: "Brush" })).toBeVisible();
    // And no save can go out with an empty list in place of the unread one.
    expect(writes.filter((w) => w.path.endsWith("/keepout"))).toEqual([]);
  });
});

test.describe("the floor plan editor's waypoint list", () => {
  test("shows five rows of twenty, and scrolls to the rest", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const twenty = Array.from({ length: 20 }, (_, i) =>
      vertex({
        id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        name: `stop-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      vertices: twenty,
    });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);

    const toggle = page.getByRole("button", { name: /^Waypoints/ });
    await expect(toggle).toContainText("20");
    await toggle.click();

    // Rows whose whole box lies inside the list's box are the ones on screen.
    const list = page
      .locator("ul")
      .filter({ has: page.getByRole("button", { name: /stop-01/ }) });
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
    await expect(
      page.getByRole("button", { name: /stop-20/ }),
    ).toBeInViewport();
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the floor plan editor", () => {
  test("aims a new waypoint by the direction it was dragged", async ({
    page,
  }) => {
    // The editor's half of the shared heading rule: a drag straight up the
    // screen is +y on the map, 90°, and that must reach the robot.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    const created: unknown[] = [];
    await page.route(/\/api\/v1\/maps\/[^/]+\/vertices$/, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const [draft] = route.request().postDataJSON() as Record<
        string,
        unknown
      >[];
      created.push(draft);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          vertex({ ...draft, id: "55555555-5555-5555-5555-555555555555" }),
        ]),
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
    // Staged, not sent: the toolbar's Save is what writes it.
    expect(created).toEqual([]);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect.poll(() => created).toHaveLength(1);
    const sent = created[0] as { name: string; theta: number };
    expect(sent.name).toBe("north-door");
    expect(sent.theta).toBeCloseTo(90, 5);
    expect(errors, "the page logged errors").toEqual([]);
  });
});

test.describe("the floor plan editor's staged waypoints", () => {
  const verticesPath = `/api/v1/maps/${MAP_NAME}/vertices`;
  const save = (page: Page) => page.getByRole("button", { name: "Save", exact: true });

  /** Place a waypoint at an offset from the canvas centre and name it. */
  const place = async (page: Page, name: string, dx: number) => {
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2);
    await page.getByRole("textbox", { name: "Name" }).fill(name);
    await page.getByRole("button", { name: "Create" }).click();
  };

  /** Open the list and make `name` the form's subject. */
  const open = async (page: Page, name: string) => {
    // Apply keeps the form on its waypoint; Close goes back to the list.
    const close = page.getByRole("button", { name: "Close", exact: true });
    if (await close.isVisible()) await close.click();
    const toggle = page.getByRole("button", { name: /^Waypoints/ });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
  };

  test("sends every waypoint placed in one request, only on Save", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await expect(save(page)).toBeDisabled();

    await page.getByRole("button", { name: "Place" }).click();
    await place(page, "shelf-a", -40);
    await place(page, "shelf-b", 40);

    // Both on screen and lit as unsaved; nothing has reached the robot.
    await expect(page.getByRole("button", { name: /^Waypoints/ })).toContainText("3");
    await expect(save(page)).toBeEnabled();
    expect(writes.filter((w) => w.path.startsWith(verticesPath))).toEqual([]);

    await save(page).click();
    await expect(page.getByText("Waypoints saved")).toBeVisible();
    await expect(page.getByText("2 added")).toBeVisible();
    const posts = writes.filter((w) => w.path === verticesPath);
    expect(posts).toHaveLength(1);
    expect(posts[0].method).toBe("POST");
    expect((posts[0].body as { name: string }[]).map((d) => d.name)).toEqual([
      "shelf-a",
      "shelf-b",
    ]);
    await expect(save(page)).toBeDisabled();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps the first save's waypoints apart from the next save's", async ({ page }) => {
    // Two saves, each with a create. Waypoints are matched by id, so a reused
    // id would fold two into one and leave Save lit with nothing to fix.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    const count = page.getByRole("button", { name: /^Waypoints/ });

    await page.getByRole("button", { name: "Place" }).click();
    await place(page, "first", -40);
    await save(page).click();
    await expect(page.getByText("1 added")).toBeVisible();

    await place(page, "second", 40);
    await save(page).click();
    await expect(page.getByText("1 added")).toBeVisible();
    await expect(count).toContainText("3");
    await expect(save(page)).toBeDisabled();

    // Only the two creates went out; no update chased a stop that collided.
    expect(
      writes.filter((w) => w.path.startsWith(verticesPath)).map((w) => w.method),
    ).toEqual(["POST", "POST"]);
    await count.click();
    await expect(page.getByRole("button", { name: /first/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /second/ })).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("holds a rename and a delete until Save, and deletes first", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const bay = vertex({ id: "22222222-2222-2222-2222-222222222222", name: "bay" });
    const writes = await mockBackend(page, { vertices: [vertex(), bay] });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);

    await open(page, "dock");
    await page.getByRole("textbox", { name: "Name" }).fill("dock-a");
    await page.getByRole("button", { name: "Apply" }).click();
    await open(page, "bay");
    await page.getByRole("button", { name: "Delete waypoint" }).click();

    expect(writes.filter((w) => w.path.startsWith(verticesPath))).toEqual([]);
    await save(page).click();
    await expect(page.getByText("1 changed · 1 deleted")).toBeVisible();

    const sent = writes.filter((w) => w.path.startsWith(verticesPath));
    expect(sent.map((w) => `${w.method} ${w.path}`)).toEqual([
      `DELETE ${verticesPath}/${bay.id}`,
      `PUT ${verticesPath}/${vertex().id}`,
    ]);
    expect(sent[1].body).toEqual({ name: "dock-a" });
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("takes a delete and a placement back with Undo, and Save sends what is left", async ({
    page,
  }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const bay = vertex({ id: "22222222-2222-2222-2222-222222222222", name: "bay" });
    const writes = await mockBackend(page, {
      gridImage: floorPlanPng(400, 300, 254),
      vertices: [vertex(), bay],
    });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    const count = page.getByRole("button", { name: /^Waypoints/ });
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const redo = page.getByRole("button", { name: "Redo", exact: true });
    await expect(undo).toBeDisabled();

    // A delete, with no confirm in the way: it is staged, and Undo is the
    // way back.
    await open(page, "bay");
    await page.getByRole("button", { name: "Delete waypoint" }).click();
    await expect(count).toContainText("1");
    await expect(save(page)).toBeEnabled();

    await undo.click();
    await expect(count).toContainText("2");
    // Back to what the robot holds, so there is nothing to save.
    await expect(save(page)).toBeDisabled();
    await redo.click();
    await expect(count).toContainText("1");

    // A placement after it, then Undo takes back only the placement.
    await page.getByRole("button", { name: "Place" }).click();
    await place(page, "shelf-a", 0);
    await expect(count).toContainText("2");
    await page.keyboard.press("Control+z");
    await expect(count).toContainText("1");

    await save(page).click();
    await expect(page.getByText("1 deleted")).toBeVisible();
    expect(
      writes
        .filter((w) => w.path.startsWith(verticesPath))
        .map((w) => `${w.method} ${w.path}`),
    ).toEqual([`DELETE ${verticesPath}/${bay.id}`]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("keeps what was refused unsaved, and does not resend what landed", async ({ page }) => {
    const bay = vertex({ id: "22222222-2222-2222-2222-222222222222", name: "bay" });
    const writes = await mockBackend(page, { vertices: [vertex(), bay] });
    let refuse = true;
    await page.route(/\/api\/v1\/maps\/[^/]+\/vertices\/[^/]+$/, (route) => {
      if (route.request().method() !== "PUT" || !refuse) return route.fallback();
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "A waypoint named dock-a already exists." }),
      });
    });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);

    await open(page, "dock");
    await page.getByRole("textbox", { name: "Name" }).fill("dock-a");
    await page.getByRole("button", { name: "Apply" }).click();
    await open(page, "bay");
    await page.getByRole("button", { name: "Delete waypoint" }).click();
    await save(page).click();

    // The backend's sentence verbatim, after what did land.
    await expect(page.getByText("Waypoints not saved")).toBeVisible();
    await expect(
      page.getByText(
        "Saved first: 1 deleted. The rest are still unsaved. A waypoint named dock-a already exists.",
      ),
    ).toBeVisible();
    await expect(save(page)).toBeEnabled();

    refuse = false;
    const before = writes.length;
    await save(page).click();
    await expect(page.getByText("1 changed")).toBeVisible();
    // The retry is the rename alone: the delete already landed.
    expect(
      writes
        .slice(before)
        .filter((w) => w.path.startsWith(verticesPath))
        .map((w) => w.method),
    ).toEqual(["PUT"]);
  });
});

test.describe("the step editor", () => {
  test("reorders by menu, drag and keyboard, and saves in the order shown", async ({
    page,
  }) => {
    // Three ways to move a row. Step ids are positional, so a reorder that
    // only moved the DOM would still post the old order.
    await mockBackend(page);
    // The create's echo is schema-checked, so this route replaces the
    // generic "ok", and reads the posted body.
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
    // Each row's type label, top to bottom: the one in its fold toggle, since
    // the seam above a row carries a label of its own.
    const order = () =>
      rows.evaluateAll((items) =>
        items.map(
          (item) => item.querySelector("[aria-expanded] .instrument-label")?.textContent,
        ),
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

    // Keyboard: pick the last row up, one slot up, drop. Before the ArrowUp
    // (this failed only under load):
    // - the rows have finished sliding after the mouse drop, since rows
    //   measured mid-transition are not where they will be;
    // - the rows have been measured at all: `aria-pressed` flips before that,
    //   the first "is over" announcement after.
    await expect
      .poll(() =>
        rows.evaluateAll((items) =>
          items.every((i) => i.getAnimations().length === 0),
        ),
      )
      .toBe(true);
    const grip = page.getByRole("button", { name: "Reorder step 3" });
    await grip.focus();
    await page.keyboard.press("Space");
    await expect(grip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("is over position 3 of 3")).toBeAttached();
    // Even then, about one ArrowUp in thirty under load is dropped outright
    // (cause not found), so it is pressed again, as an operator would. The
    // 1.5 s window is observed, not enforced: a key landing later would move
    // two slots and fail the order assertion — a failed run, never a wrong pass.
    await expect(async () => {
      await page.keyboard.press("ArrowUp");
      await expect(page.getByText("is over position 2 of 3")).toBeAttached({
        timeout: 1_500,
      });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Space");
    await expect.poll(order).toEqual(["Lie", "Stand", "Speak"]);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Task name" })
      .fill("reorder-check");
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
    // A loaded template arrives as one-line summaries, and every row folds —
    // an unfinished one too, with its problem as its summary, so it is
    // findable when Save is greyed out.
    await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    // The MOVE row's only input is its waypoint picker.
    const waypoint = page.getByRole("combobox", {
      name: "Waypoint for step 1",
    });
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
    const speakRow = page.getByRole("button", {
      name: /^Speak/,
      expanded: false,
    });
    await expect(speakRow).toHaveText(/Needs something to say\./);

    // Unfold, fill, fold: the line is read back in place of the problem.
    await speakRow.click();
    await say.fill("Hello");
    await page.getByRole("button", { name: /^Speak/, expanded: true }).click();
    await expect(say).toHaveCount(0);
    await expect(page.getByText("“Hello”")).toBeVisible();
  });

  test("saves a Wait step's duration as seconds, refusing one past the hour", async ({
    page,
  }) => {
    await mockBackend(page);
    const posted: { steps: unknown[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const body = request.postDataJSON() as { name: string; steps: unknown[] };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(taskTemplate({ name: body.name })),
      });
    });
    await page.goto("/tasks/editor");

    await page.getByTitle("Stay put for a set time, then go on.").click();
    const duration = page.getByRole("textbox", { name: "Duration" });
    await expect(duration).toBeVisible();

    // Past the backend's hour, the row says so and Save is held — the 422
    // would otherwise be a validation array on the operator's screen.
    await duration.fill("3601");
    await expect(page.getByText("At most 3600 seconds (1 hour).")).toBeVisible();
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();

    await duration.fill("90");
    await save.click();
    await page.getByRole("textbox", { name: "Task name" }).fill("pause at dock");
    await page.keyboard.press("Enter");
    await expect.poll(() => posted).toHaveLength(1);
    // The on-screen word is Duration; the wire field is `seconds`, a number.
    expect(posted[0]!.steps).toEqual([
      { id: "1-wait", type: "WAIT", params: { seconds: 90 } },
    ]);
  });

  test("waits out a conversion before drawing the floor plan it produced", async ({
    page,
  }) => {
    // A raster read mid-conversion is stale or half-written, and this cache
    // never goes stale on its own, so it is not read until the catalogue says
    // the conversion is over — including one another console started.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const entry = mapSummary({
      grid_status: "converting",
      grid_converting: true,
    });
    await mockBackend(page, { maps: [entry] });
    const imageReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/image")) imageReads.push(pathname);
    });
    await page.goto("/tasks/editor");
    // The floor plan opens from a Move row, beside its waypoint picker.
    await page.getByTitle("Drive to a pose in the map frame.").click();
    await page.getByRole("button", { name: "Floor plan for step 1" }).click();
    await expect(
      page.getByRole("img", { name: /^Floor plan of dp2f/ }),
    ).toBeVisible();

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
    // The floor plan under a Move row shows the route: every waypoint the job
    // goes to is lit and named with its step numbers, for a screen reader too.
    const room = vertex({
      id: "44444444-4444-4444-4444-444444444444",
      name: "room-a",
      type: "MOVE",
      x: -3,
      y: 4,
      theta: 0,
    });
    await mockBackend(page, { vertices: [vertex(), room] });
    await page.goto("/tasks/editor");

    // The button belongs to a Move row, not to the Steps header.
    const toggle = page.getByRole("button", { name: "Floor plan for step 1" });
    await expect(page.getByRole("button", { name: /^Floor plan/ })).toHaveCount(0);
    await page.getByTitle("Drive to a pose in the map frame.").click();
    await expect(toggle).toHaveCount(1);

    // Closed until asked for.
    const plan = page.getByRole("img", {
      name: /^Floor plan of dp2f with 2 waypoints/,
    });
    await expect(plan).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(plan).toBeVisible();
    // Nothing picked yet, so nothing is lit.
    await expect(plan).toHaveAccessibleName(/waypoints\.$/);

    // The pick is made on the row, and the map says where it went.
    const waypoint = page.getByRole("combobox", {
      name: "Waypoint for step 1",
    });
    await waypoint.click();
    await page.getByRole("option", { name: "room-a" }).click();
    await expect(waypoint).toContainText("room-a");
    await expect(plan).toHaveAccessibleName(/; room-a is step 1\.$/);

    // A second Move to the dock: both stops, in job order, on the map the
    // first row opened — it is the job's route, not the row's pick.
    await page.getByTitle("Drive to a pose in the map frame.").click();
    await expect(page.getByRole("button", { name: "Floor plan for step 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const second = page.getByRole("combobox", { name: "Waypoint for step 2" });
    await second.click();
    await page.getByRole("option", { name: "dock" }).click();
    await expect(plan).toHaveAccessibleName(
      /; room-a is step 1, dock is step 2\.$/,
    );

    // The map is a view: a click on it sets nothing on any row.
    const box = (await plan.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(waypoint).toContainText("room-a");
    await expect(second).toContainText("dock");
  });

  test("saves a Dock on the waypoint picked", async ({ page }) => {
    // A Dock rides the Move wire with its own type. Both halves asserted: the
    // row on screen, and the type, waypoint and map in the body.
    await mockBackend(page);
    const posted: { map_name?: string; steps: Record<string, unknown>[] }[] = [];
    await page.route("**/api/v1/task_templates", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as (typeof posted)[number] & { name: string };
      posted.push(body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          taskTemplate({ id: "77777777-7777-7777-7777-777777777777", name: body.name }),
        ),
      });
    });
    await page.goto("/tasks/editor");
    await expect(page.getByRole("heading", { name: "New task" })).toBeAttached();
    await page.getByRole("textbox", { name: "Task name" }).fill("charge");

    await page.getByTitle(/^Go to a waypoint, then walk straight onto the charger/).click();
    const dockAt = page.getByRole("combobox", { name: "Charger waypoint for step 1" });
    await dockAt.click();
    await page.getByRole("option", { name: "dock" }).click();
    await expect(dockAt).toContainText("dock");


    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => posted).toHaveLength(1);
    expect(posted[0]!.map_name).toBe(MAP_NAME);
    expect(posted[0]!.steps).toEqual([
      { id: "1-dock", type: "DOCK", params: { x: 2.5, y: 1.25, theta: 90 }, vertex_id: vertex().id },
    ]);
  });


  test("zooms the floor plan and comes back to fit", async ({ page }) => {
    // At fit scale two waypoints a body length apart are one smear, so the
    // wheel, the buttons and Fit zoom; the scale is read off data-zoom.
    // A real 400 x 300 grid, so the raster has an extent to zoom into.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto("/tasks/editor");
    await page.getByTitle("Drive to a pose in the map frame.").click();
    await page.getByRole("button", { name: "Floor plan for step 1" }).click();
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

    // Zooming out stops at the opening view, which already shows the whole
    // floor plan.
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
    // The default window reaches back a day from now, and the fixture's jobs
    // closed on 2026-09-18; a real clock would have aged them out of it.
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
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
      kind: "schedule",
      name: "Morning round",
    }),
  ];

  /** A dashboard tile's number, by its label. */
  const tile = (dashboard: Locator, label: string) =>
    dashboard
      .locator("dt", { hasText: label })
      .locator("xpath=following-sibling::dd[1]");

  /** The two reads one filter makes, as the fake saw them. */
  const historyReads = (
    page: Page,
    match: (params: URLSearchParams) => boolean,
  ) =>
    Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history" && match(url.searchParams)
        );
      }),
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history/stats" &&
          match(url.searchParams)
        );
      }),
    ]);

  test("lists each job by its name or kind, with who started it and how long it took", async ({
    page,
  }) => {
    await mockBackend(page, {
      taskHistory: finished,
      // Opened below; without a body the detail is a 404 the console logs.
      taskStates: {
        "robot01-task-1758000000-1": {
          id: "robot01-task-1758000000-1",
          status: "COMPLETED",
          steps: [{ id: "1-move", status: "COMPLETED", error_msg: "" }],
        },
      },
    });
    const listed = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/v1/task_history",
    );
    await page.goto("/history");
    const params = new URL((await listed).url()).searchParams;
    // Ten a page, asked for explicitly rather than left to the backend's 20.
    expect(params.get("page_size")).toBe("10");
    // The last day, open-ended: a job finishing while the page is open must
    // land inside the window.
    expect(params.get("since")).toBe("2026-09-17T10:00:00.000Z");
    expect(params.get("until")).toBeNull();

    // A job with no template name is called by its kind; a scheduled one by
    // the template it ran. Never by its id.
    await expect(
      page.getByRole("button", { name: /^COMPLETED Task Started directly/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^FAILED Morning round Scheduled · nightly/,
      }),
    ).toBeVisible();
    await expect(page.getByText("robot01-task-1758000000-1")).toBeHidden();
    // 09:40:00 → 09:44:12, measured between the backend's own timestamps.
    await expect(page.getByText("4:12", { exact: true })).toBeVisible();
    await expect(page.getByText("12:30", { exact: true })).toBeVisible();
    // Everything fits on one page, so there is nothing to page through.
    await expect(
      page.getByRole("navigation", { name: "History pages" }),
    ).toBeHidden();

    // The id is still there for whoever needs it: on expand.
    await page
      .getByRole("button", { name: /^COMPLETED Task Started directly/ })
      .click();
    await expect(
      page.getByText("robot01-task-1758000000-1", { exact: true }),
    ).toBeVisible();
  });

  test("counts the jobs the robot reports, per outcome and per kind", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");

    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(dashboard).toBeVisible();
    await expect(tile(dashboard, "Finished")).toHaveText("2");
    await expect(tile(dashboard, "Completed")).toHaveText("1");
    await expect(tile(dashboard, "Failed")).toHaveText("1");
    await expect(tile(dashboard, "Canceled")).toHaveText("0");
    await expect(tile(dashboard, "Success rate")).toHaveText("50 %");
    // The one bar lists every outcome on hover, zero included.
    await expect(
      dashboard.getByTitle("Completed 1 · Failed 1 · Canceled 0"),
    ).toBeAttached();
  });

  test("lists only failed jobs when that outcome is picked, without changing the counts", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    // The list re-reads with the outcome, and the window survives it.
    const filtered = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        url.pathname === "/api/v1/task_history" &&
        url.searchParams.get("status") === "FAILED" &&
        url.searchParams.get("since") !== null
      );
    });
    await page.getByRole("combobox", { name: "Outcome" }).click();
    await page.getByRole("option", { name: "Failed" }).click();
    await filtered;

    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(
      page.getByText(/Only failed jobs are listed below/),
    ).toBeVisible();
    // The dashboard is how the window's jobs ended, whichever are listed:
    // Finished still says 2 and the rate is still 50 %, not 0 %.
    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(tile(dashboard, "Finished")).toHaveText("2");
    await expect(tile(dashboard, "Success rate")).toHaveText("50 %");
    await expect(page).toHaveURL(/status=FAILED/);
  });

  test("asks for the last six hours when that preset is picked, and says so in the address", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) =>
        params.get("since") === "2026-09-18T04:00:00.000Z" &&
        params.get("until") === null,
    );
    await page.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "Last 6 h" }).click();
    await narrowed;

    await expect(page).toHaveURL(/\/history\?range=6h$/);
    // The scheduled job closed at 01:12, outside the six hours.
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeHidden();
    // Something is narrowed now, so there is something to reset.
    await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  });

  test("narrows both the counts and the list to one template's jobs", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) => params.get("name") === "Morning round",
    );
    await page.getByRole("combobox", { name: "Name" }).click();
    await page.getByRole("option", { name: "Morning round" }).click();
    await narrowed;

    await expect(page).toHaveURL(/name=Morning\+round/);
    await expect(page.getByText("Started directly")).toBeHidden();
    const dashboard = page.getByRole("region", { name: "Over this window" });
    await expect(tile(dashboard, "Finished")).toHaveText("1");
  });

  test("narrows to scheduled jobs by kind, in the operator's words", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    const narrowed = historyReads(
      page,
      (params) => params.get("kind") === "schedule",
    );
    await page.getByRole("combobox", { name: "Kind" }).click();
    await page.getByRole("option", { name: "Scheduled" }).click();
    await narrowed;

    await expect(page).toHaveURL(/kind=schedule/);
    await expect(page.getByText("Started directly")).toBeHidden();
    await expect(page.getByText("Scheduled · nightly")).toBeVisible();
  });

  test("reads a filter back from the address bar", async ({ page }) => {
    await mockBackend(page, { taskHistory: finished });
    // The outcome reaches the list only; the counts are read without it.
    const read = Promise.all([
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history" &&
          url.searchParams.get("status") === "FAILED" &&
          url.searchParams.get("kind") === "schedule" &&
          url.searchParams.get("since") === "2026-09-18T04:00:00.000Z"
        );
      }),
      page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === "/api/v1/task_history/stats" &&
          url.searchParams.get("status") === null &&
          url.searchParams.get("kind") === "schedule" &&
          url.searchParams.get("since") === "2026-09-18T04:00:00.000Z"
        );
      }),
    ]);
    await page.goto("/history?status=FAILED&range=6h&kind=schedule");
    await read;

    await expect(page.getByRole("combobox", { name: "Outcome" })).toContainText(
      "Failed",
    );
    await expect(page.getByRole("combobox", { name: "Time" })).toContainText(
      "Last 6 h",
    );
    await expect(page.getByRole("combobox", { name: "Kind" })).toContainText(
      "Scheduled",
    );
  });

  test("sends a custom range as UTC from the operator's own clock", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history");
    await expect(page.getByText("Started directly")).toBeVisible();

    await page.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "Custom range…" }).click();
    // Seeded from the window that was on screen, so the fields are never blank.
    await expect(page).toHaveURL(
      /range=custom&from=2026-09-17T10%3A00%3A00.000Z&to=2026-09-18T10%3A00%3A00.000Z/,
    );

    // The test browser's zone is UTC, so 09:00 typed is 09:00Z sent; the
    // conversion itself is covered in lib/task/history.test.ts for any zone.
    const bounded = historyReads(
      page,
      (params) =>
        params.get("since") === "2026-09-18T09:00:00.000Z" &&
        params.get("until") === "2026-09-18T10:00:00.000Z",
    );
    await page.getByLabel("From").fill("2026-09-18T09:00");
    await bounded;

    // The scheduled job closed at 01:12, before the range.
    await expect(page.getByText("Started directly")).toBeVisible();
    await expect(page.getByText("Scheduled · nightly")).toBeHidden();
  });

  test("says so when the window holds no finished job", async ({ page }) => {
    await mockBackend(page, { taskHistory: [] });
    await page.goto("/history");

    // Once under the counts, once where the list would be.
    await expect(
      page.getByText("No finished job in this window.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "No finished job in this window. Jobs appear here once they end.",
      ),
    ).toBeVisible();
  });

  test("offers to clear the filters when they match nothing", async ({
    page,
  }) => {
    await mockBackend(page, { taskHistory: finished });
    await page.goto("/history?status=CANCELED");

    await expect(
      page.getByText("No finished job on this robot matches these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/history$/);
    await expect(page.getByText("Started directly")).toBeVisible();
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
    await page.getByText("Morning round").click();
    await described;

    await expect(
      page.getByRole("button", { name: /Morning round/ }),
    ).toHaveAttribute("aria-expanded", "true");
    // The id, once, in the detail.
    await expect(page.getByText("nightly-2026-09-18T01:00:00Z")).toBeVisible();
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

    await expect(
      page.getByText("List task history failed").first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry" }).first(),
    ).toBeVisible();
  });

  test("keeps the list when only the counts cannot be read", async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-09-18T10:00:00Z"));
    await mockBackend(page, { taskHistory: [taskHistoryEntry()] });
    await page.route("**/api/v1/task_history/stats**", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Task history stats failed" }),
      }),
    );
    await page.goto("/history");

    await expect(page.getByText("Task history stats failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Started directly")).toBeVisible();
  });
});

test.describe("what a dispatch records about itself", () => {
  // The history can only count and filter what the dispatch said it was:
  // its kind, and the template it came from.
  test("sends a saved job with its name and kind", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Dispatch "Morning round" now' })
      .click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const body = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      id: string;
      kind: string;
      name: string | null;
      map_name?: string;
      steps: unknown[];
    };
    expect(body.kind).toBe("task");
    expect(body.name).toBe("Morning round");
    // The map its coordinates were saved on, for the backend to check.
    expect(body.map_name).toBe(MAP_NAME);
    expect(body.id).toMatch(/^robot01-task-\d+-\d+$/);
    expect(body.steps).toHaveLength(1);
  });

  test("sends a posture as its own kind, with no name", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/");

    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await page.getByRole("button", { name: "Stand", exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
    const body = writes.find((w) => w.path === "/api/v1/tasks")!.body as {
      id: string;
      kind: string;
      name: string | null;
    };
    expect(body.kind).toBe("standup");
    expect(body.name).toBeNull();
    // A posture uses no map, so it names none.
    expect(body).not.toHaveProperty("map_name");
    expect(body.id).toMatch(/^robot01-standup-\d+-\d+$/);
  });
});

test.describe("a map whose floor plan is being rebuilt", () => {
  const converting = () => [
    mapSummary({ grid_status: "converting", grid_converting: true }),
  ];

  test("holds a saved job's Run, and says why", async ({ page }) => {
    const writes = await mockBackend(page, { maps: converting() });
    await page.goto("/tasks");

    await expect(
      page.getByRole("button", { name: 'Dispatch "Morning round" now' }),
    ).toBeDisabled();
    await expect(
      page.getByText(/This map's floor plan is being rebuilt/),
    ).toBeVisible();
    expect(writes.filter((w) => w.path === "/api/v1/tasks")).toEqual([]);
  });

  test("holds Set goal, but still lets the robot stand", async ({ page }) => {
    const writes = await mockBackend(page, { maps: converting() });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Set goal" })).toBeDisabled();
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await page.getByRole("button", { name: "Stand", exact: true }).click();
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/tasks"))
      .toHaveLength(1);
  });
});

test.describe("a job the robot refuses for its map", () => {
  // No console-error guard: the browser logs the 409 itself, which is the
  // response under test.
  test("shows the backend's sentence under the library", async ({ page }) => {
    await mockBackend(page);
    const refusal =
      "This job was planned on map dp2f, but the robot is using map wh1. Switch maps first.";
    await page.route("**/api/v1/tasks", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal, code: "map_mismatch" }),
          })
        : route.fallback(),
    );
    await page.goto("/tasks");

    await page
      .getByRole("button", { name: 'Dispatch "Morning round" now' })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
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
    await expect(
      row.getByRole("button", { name: "Save schedule" }),
    ).toBeVisible();
  });
});
