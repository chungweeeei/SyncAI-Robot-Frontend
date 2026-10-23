import { expect, test, type Page } from "@playwright/test";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  floorPlanPng,
  mapSummary,
  mockBackend,
  vertex,
} from "./backend";

/**
 * The floor plan editor: its draw bar, forbidden zones and staged waypoints.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
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
    // Its name and floor band go back too, unset here: a zone sent without
    // the band it was read with would widen to every storey of a 3D map.
    expect(body.zones[0]).toEqual({ ...saved, name: null, z_min: null, z_max: null });
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
