import { expect, test, type Page } from "@playwright/test";

import { MAP_NAME, failOnConsoleErrors, floorPlanPng, mockBackend } from "./backend";

/**
 * The console on a phone: 375 px wide, driven by a finger.
 *
 * Only the `mobile` project runs this file (see playwright.config.ts), and
 * only what a phone changes is checked here: whether the chrome fits, whether
 * a panel opens on screen, and whether a second finger on the viewport is
 * treated as the pinch it is rather than as a second press. Everything a
 * phone does not change is already covered by the desktop suite.
 */

const WIDTH = 375;
/** The smallest target a finger reliably lands on. Everything tappable is at least this. */
const TARGET = 40;

const NAV = [
  "Dashboard",
  "Mapping",
  "Maps",
  "Recordings",
  "Tasks",
  "History",
  "Settings",
];

async function expectOnScreen(page: Page, name: string, box: { x: number; y: number; width: number; height: number } | null) {
  expect(box, `${name} has no box`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${name} starts past the left edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${name} ends past the right edge`).toBeLessThanOrEqual(WIDTH);
  const viewport = page.viewportSize();
  if (viewport) {
    expect(box.y, `${name} starts above the top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${name} ends below the bottom`).toBeLessThanOrEqual(viewport.height);
  }
}

test.describe("the console on a phone", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("reports a coarse pointer", async ({ page }) => {
    // The guard that makes the size assertions below mean anything: every
    // 40 px target is a `pointer-coarse:` rule, so if Chromium's phone
    // emulation ever stops matching that query this fails first, with a
    // readable reason, instead of the others failing on a number.
    await mockBackend(page);
    await page.goto("/settings");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
  });

  test("keeps every rail tab and the theme switch on screen", async ({ page }) => {
    // Seven icon-plus-label tabs used to need ~780 px inside a body that
    // cannot scroll, so Dashboard and Settings were cut off at both ends.
    await mockBackend(page);
    await page.goto("/settings");

    for (const name of NAV) {
      const link = page.getByRole("link", { name, exact: true });
      const box = await link.boundingBox();
      await expectOnScreen(page, name, box);
      expect(box?.width, `${name} is narrower than a finger`).toBeGreaterThanOrEqual(TARGET);
      expect(box?.height, `${name} is shorter than a finger`).toBeGreaterThanOrEqual(TARGET);
    }

    const toggle = page.getByRole("button", { name: /^Switch (to|day)/ });
    const box = await toggle.boundingBox();
    await expectOnScreen(page, "the theme switch", box);
    expect(box?.width).toBeGreaterThanOrEqual(TARGET);
    expect(box?.height).toBeGreaterThanOrEqual(TARGET);

    // And nothing else leaked past the edge either: a body that scrolls
    // sideways is a control somewhere that cannot be reached.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("drops the drive panel and the camera window inside the viewport", async ({
    page,
  }) => {
    // Both hung off a button 100–240 px from the right edge, so a 256–320 px
    // panel opened past the left edge of the screen.
    await mockBackend(page);
    await page.goto("/settings");

    const drive = page.getByRole("button", { name: "Manual drive panel" });
    await drive.click();
    const driveHeading = page.getByRole("heading", { name: "Manual drive" });
    await expect(driveHeading).toBeVisible();
    // The panel is the nearest positioned ancestor that owns the heading; the
    // desktop suite locates it the same way.
    const drivePanel = page.locator("div", { has: driveHeading }).last();
    await expectOnScreen(page, "the drive panel", await drivePanel.boundingBox());
    await drive.click();
    await expect(driveHeading).toHaveCount(0);

    const camera = page.getByRole("button", { name: "Camera window" });
    await camera.click();
    const cameraHeading = page.getByRole("heading", { name: "Camera" });
    await expect(cameraHeading).toBeVisible();
    const cameraPanel = page.locator("div", { has: cameraHeading }).last();
    await expectOnScreen(page, "the camera window", await cameraPanel.boundingBox());

    // The corner grip is the smallest control in the console; under a finger
    // it grows with the rest.
    const grip = page.getByRole("button", { name: "Resize the camera window" });
    const gripBox = await grip.boundingBox();
    expect(gripBox?.width).toBeGreaterThanOrEqual(TARGET);
    expect(gripBox?.height).toBeGreaterThanOrEqual(TARGET);
  });

  test("drops a goal draft when a second finger lands", async ({ page }) => {
    // A pinch on the viewport with Set goal armed used to re-enter the press
    // handler with the second finger, and the first finger's lift committed
    // whatever it was aiming — a MOVE task to a spot nobody chose.
    //
    // The fake answers POST /tasks with a bare {message}, which the ack
    // schema refuses (and rightly: the id is a poll target). This test wants
    // the positive control to succeed, so it answers with a real ack and a
    // finished task for the poll that follows.
    const ID = "robot01-goal-e2e";
    await mockBackend(page, {
      taskStates: {
        [ID]: {
          id: ID,
          status: "COMPLETED",
          steps: [{ id: "goal", status: "COMPLETED", error_msg: "" }],
        },
      },
    });
    const dispatches: unknown[] = [];
    await page.route("**/api/v1/tasks", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      dispatches.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ id: ID, status: "PENDING", message: "ok" }),
      });
    });

    await page.goto("/");
    const viewport = page.getByRole("region", { name: "Map viewport" });
    await expect(viewport).toBeVisible();
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Touch events are dispatched over CDP rather than page.touchscreen,
    // which only knows a single tap; a pinch is two fingers, and it is the
    // second one that used to do the damage.
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", touchPoints: { x: number; y: number; id: number }[]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });

    await page.getByRole("button", { name: "Set goal" }).click();
    await touch("touchStart", [finger(cx, cy, 1)]);
    await touch("touchStart", [finger(cx, cy, 1), finger(cx + 60, cy + 60, 2)]);
    await touch("touchMove", [finger(cx - 20, cy - 20, 1), finger(cx + 80, cy + 80, 2)]);
    await touch("touchEnd", [finger(cx - 20, cy - 20, 1)]);
    await touch("touchEnd", []);
    // Waited on rather than checked once, because a commit would arrive a
    // tick after the lift.
    await page.waitForTimeout(500);
    expect(dispatches, "a pinch dispatched a goal").toEqual([]);
    // And the tool is still armed: the operator zoomed, they did not give up
    // on placing a goal, and only a commit disarms.
    await expect(page.getByRole("button", { name: "Set goal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("status").filter({ hasText: "Aim and release to send" })).toBeVisible();

    // The positive control, or the assertion above is vacuous: one finger,
    // pressed and lifted, is a goal.
    await touch("touchStart", [finger(cx, cy, 1)]);
    await touch("touchEnd", []);
    await expect.poll(() => dispatches.length).toBe(1);
    const body = dispatches[0] as { steps: { type: string }[] };
    expect(body.steps[0].type).toBe("MOVE");
  });

  test("lays the floor plan editor's panels out without one covering the other", async ({
    page,
  }) => {
    // At 375 px the 224 px toolbar and the 240 px waypoint panel used to hang
    // from the top corners and overlap by ~110 px, with the panel on top of
    // the toolbar's Save.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await expect(page.getByRole("toolbar", { name: "Draw" })).toBeVisible();

    const save = await page.getByRole("button", { name: "Save" }).boundingBox();
    // .last(): the Mode row's "Waypoints" segment comes first in the DOM.
    const waypoints = await page.getByText("Waypoints", { exact: true }).last().boundingBox();
    await expectOnScreen(page, "Save", save);
    await expectOnScreen(page, "the waypoint panel's heading", waypoints);
    expect(
      waypoints!.y,
      "the waypoint panel starts above the toolbar's Save",
    ).toBeGreaterThan(save!.y + save!.height);

    // And the tool icons say their names under a finger.
    await expect(page.getByRole("button", { name: "Place" })).toContainText("Place");
  });

  test("zooms the floor plan with two fingers instead of painting between them", async ({
    page,
  }) => {
    // With Brush armed a second finger used to replace the stroke and the
    // next move painted a line from one finger to the other. Now two
    // fingers are a pinch, and the only mark on the map is the first
    // finger's own press.
    // A real grid, matching the catalogue's 400 x 300: the 1 px default is
    // one cell the size of the canvas, and a pinch shrinks it out from under
    // the fingers, which would make both halves of this test touch nothing.
    // Unknown cells, so painting Floor is a change worth saving.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto(`/maps/${MAP_NAME}/edit`);
    await expect(page.getByRole("toolbar", { name: "Draw" })).toBeVisible();
    await page.locator("canvas").waitFor();

    const box = (await page.locator("canvas").boundingBox())!;
    const cx = box.x + box.width / 2;
    // Low in the canvas: on a phone the toolbar spans the top ~240 px, and a
    // finger on it would reach neither the map nor this test's point.
    const cy = box.y + box.height * 0.7;
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      touchPoints: { x: number; y: number; id: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });

    // A pan press, then the pinch: the editor opens with nothing chosen to
    // draw and only Pan offered, so this is the gesture a phone makes to look
    // around before painting.
    // exact: "Manual drive panel" in the strip contains the word.
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await touch("touchStart", [finger(cx - 30, cy, 1)]);
    await touch("touchStart", [finger(cx - 30, cy, 1), finger(cx + 30, cy, 2)]);
    await touch("touchMove", [finger(cx - 80, cy, 1), finger(cx + 80, cy, 2)]);
    await touch("touchEnd", [finger(cx - 80, cy, 1)]);
    await touch("touchEnd", []);
    // Nothing was painted, so there is nothing to save — and the map did
    // zoom, or "nothing painted" would be true of a canvas that ignored the
    // second finger, which is what it did before it had a pinch. Nothing on
    // screen shows the zoom, so it is read off the editor's data-zoom, which
    // is 94 at fit on this phone.
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    const zoom = page.locator("[data-zoom]");
    await expect.poll(async () => Number(await zoom.getAttribute("data-zoom"))).toBeGreaterThan(94);

    // The positive control: one finger with Brush armed does paint. Brush is
    // only offered once something is chosen to draw, and Floor on these
    // Unknown cells is a change worth saving.
    await page.getByRole("combobox", { name: "Draw" }).click();
    await page.getByRole("option", { name: "Floor", exact: true }).click();
    await page.getByRole("button", { name: "Brush" }).click();
    await touch("touchStart", [finger(cx, cy, 1)]);
    await touch("touchMove", [finger(cx + 20, cy + 20, 1)]);
    await touch("touchEnd", []);
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
