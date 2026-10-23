import { expect, test } from "@playwright/test";

import { SWITCH_NO_MAP } from "@/lib/map/switch";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  mapSummary,
  mockBackend,
  withOctomap,
} from "./backend";

/**
 * The map library: the cards, and what each control sends for its map.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
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

  test("switches the robot onto a map with a 3D map and no floor plan", async ({ page }) => {
    // The robot navigates a map on its 3D map whenever it has one, so a
    // missing floor plan is no reason to hold the switch. A map with neither
    // still is, with the reason where the button would be.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "site-2d" }),
        mapSummary({
          active: false,
          name: "site-3d",
          grid: null,
          thumbnail: null,
          grid_status: "none",
          ...withOctomap(),
        }),
        mapSummary({
          active: false,
          name: "site-bare",
          grid: null,
          thumbnail: null,
          grid_status: "none",
        }),
      ],
    });
    await page.goto("/maps");

    const bare = page.getByRole("article").filter({ hasText: "site-bare" });
    await expect(bare.locator(`span[aria-disabled="true"][title="${SWITCH_NO_MAP}"]`)).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Switch the robot to site-bare" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Switch the robot to site-3d" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Switch", exact: true })
      .click();

    await expect(page.getByText("Switched to 'site-3d'.")).toBeVisible();
    await expect(
      page.getByRole("article").filter({ hasText: "site-3d" }).getByLabel("In use"),
    ).toBeVisible();
    expect(
      writes.filter((w) => w.path.endsWith("/activate")).map((w) => `${w.method} ${w.path}`),
    ).toEqual(["POST /api/v1/maps/site-3d/activate"]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("shows a card its 3D map when it has one, else its floor plan", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const treeReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.endsWith("/octomap")) treeReads.push(pathname);
    });
    await mockBackend(page, {
      maps: [
        mapSummary({ active: true, name: "site-3d", ...withOctomap() }),
        mapSummary({ active: false, name: "site-2d" }),
        mapSummary({
          active: false,
          name: "site-bare",
          grid: null,
          thumbnail: null,
          grid_status: "none",
        }),
      ],
    });
    await page.goto("/maps");

    const still = page.getByRole("img", { name: "3D map of site-3d" });
    await expect(still).toBeVisible();
    await expect(still).toHaveAttribute("src", /^data:image\/png;base64,/);
    // The 3D map stands in for the floor plan, not beside it.
    await expect(page.getByRole("img", { name: "Floor plan of site-3d" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Floor plan of site-2d" })).toBeVisible();
    await expect(page.getByRole("img", { name: "3D map of site-2d" })).toHaveCount(0);
    await expect(
      page.getByRole("article").filter({ hasText: "site-bare" }).getByText("No preview"),
    ).toBeVisible();
    // Only the map that has a tree downloads one.
    expect(treeReads).toEqual(["/api/v1/maps/site-3d/octomap"]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("falls back to the floor plan when the 3D map cannot be read", async ({ page }) => {
    await mockBackend(page, {
      maps: [mapSummary({ active: true, name: "site-3d", ...withOctomap() })],
      octomap: Buffer.from("not a tree"),
    });
    await page.goto("/maps");

    await expect(page.getByRole("img", { name: "Floor plan of site-3d" })).toBeVisible();
    await expect(page.getByRole("img", { name: "3D map of site-3d" })).toHaveCount(0);
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
      .poll(() => writes.filter((w) => w.path === "/api/v1/robot/set_motion_key"))
      .toHaveLength(1);
  });
});
