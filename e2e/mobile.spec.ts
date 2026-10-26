import { expect, test, type Page } from "@playwright/test";

import { vertexScreen } from "@/lib/map/draw";
import { previewView } from "@/lib/map/preview";

import {
  MAP_NAME,
  activeTask,
  failOnConsoleErrors,
  floorPlanPng,
  mapSummary,
  mockBackend,
  octomapBt,
  robotState,
  taskState,
  vertex,
  withOctomap,
} from "./backend";

/**
 * The console on a phone: 375 px wide, driven by a finger. Run only by the
 * `mobile` project, and checks only what a phone changes: whether the chrome
 * fits, whether a panel opens on screen, and whether a second finger is a
 * pinch rather than a second press.
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
    // Every 40 px target is a `pointer-coarse:` rule, so if the emulation
    // stops matching that query this fails first, with a readable reason.
    await mockBackend(page);
    await page.goto("/settings");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
  });

  test("keeps every rail tab and the theme switch on screen", async ({ page }) => {
    // Seven icon-plus-label tabs need ~780 px, and the body cannot scroll,
    // so the end tabs must not be cut off.
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

  test("stacks the saved Wi-Fi networks in one column, Add network in reach", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings/wifi");

    const add = page.locator("main header").getByRole("link", { name: "Add network" });
    const addBox = await add.boundingBox();
    await expectOnScreen(page, "Add network", addBox);
    expect(addBox!.height).toBeGreaterThanOrEqual(TARGET);
    // Go back shares the title's row with it, and both still fit beside "Wi-Fi".
    const back = page.locator("main header").getByRole("link", { name: "Go back to Settings" });
    const backBox = await back.boundingBox();
    await expectOnScreen(page, "Go back", backBox);
    expect(backBox!.height).toBeGreaterThanOrEqual(TARGET);
    expect(Math.abs(backBox!.y - addBox!.y)).toBeLessThan(2);

    const cards = page.getByRole("region", { name: "Saved networks" }).getByRole("listitem");
    await expect(cards).toHaveCount(2);
    const first = (await cards.first().boundingBox())!;
    const second = (await cards.nth(1).boundingBox())!;
    // One column: the second card starts below the first, not beside it.
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);

    // The page scrolls, so a card below the fold is fine; past the side is not.
    for (const name of ["Connect to lab-5g", "Forget lab-5g"]) {
      const button = page.getByRole("button", { name });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      await expectOnScreen(page, name, box);
      expect(box!.height).toBeGreaterThanOrEqual(TARGET);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });

  test("keeps a loaded task's name readable beside the editor's buttons", async ({
    page,
  }) => {
    // Beside the editor's buttons the heading (the name field) was cut to a
    // few letters, so below sm it has a row of its own and the buttons are
    // icons alone on the next.
    await mockBackend(page);
    await page.goto("/tasks");
    await page
      .getByRole("button", { name: 'Load "Morning round" into the editor' })
      .click();
    const heading = page.getByRole("textbox", { name: "Task name" });
    await expect(heading).toHaveValue("Morning round");
    expect(
      await heading.evaluate((el) => el.scrollWidth <= el.clientWidth || console.log("ID", el.scrollWidth, el.clientWidth)),
      "the heading is cut off",
    ).toBe(true);

    for (const name of ["Go back", "Save", "Save and run"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expectOnScreen(page, name, await button.boundingBox());
      // Named for a screen reader; nothing printed (innerText skips what is
      // display:none, where textContent would not).
      expect(await button.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("");
    }
  });

  test("keeps the running job's controls on screen beside the health cluster", async ({
    page,
  }) => {
    // Of everything on the strip's row, only the robot id may give way; the
    // buttons must stay whole and under a finger.
    const ID = "robot01-task-1758000000-1";
    await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");
    const strip = page.getByRole("banner");

    await expect(strip.getByRole("status")).toContainText("2/3");
    for (const name of ["Emergency stop", "Pause the job", "Cancel the job", "Sensor alerts", "Manual drive panel", "Camera window"]) {
      const button = strip.getByRole("button", { name });
      const box = await button.boundingBox();
      await expectOnScreen(page, name, box);
      expect(box?.width, `${name} is narrower than a finger`).toBeGreaterThanOrEqual(TARGET);
      expect(box?.height, `${name} is shorter than a finger`).toBeGreaterThanOrEqual(TARGET);
    }

    // The mode is a dot here, its word kept for a screen reader: printed, it
    // would take the robot id's share of the first line.
    const mode = strip.getByTitle("Navigation");
    await expect(mode).toHaveText("Navigation");
    const modeBox = await mode.boundingBox();
    await expectOnScreen(page, "the mode chip", modeBox);
    expect(modeBox?.width, "the mode chip printed its word").toBeLessThan(TARGET);
    const stopBox = await strip.getByRole("button", { name: "Emergency stop" }).boundingBox();
    expect(
      Math.abs((modeBox?.y ?? 0) + (modeBox?.height ?? 0) / 2 - ((stopBox?.y ?? 0) + (stopBox?.height ?? 0) / 2)),
      "the mode chip left the first line",
    ).toBeLessThan(8);
    const id = strip.getByRole("link", { name: "robot01" });
    expect(
      await id.evaluate((el) => el.scrollWidth <= el.clientWidth),
      "the robot id is cut off",
    ).toBe(true);

    await strip.getByRole("button", { name: "Pause the job" }).click();
    const resume = strip.getByRole("button", { name: "Resume the job" });
    await expect(resume).toBeVisible();
    await expectOnScreen(page, "Resume the job", await resume.boundingBox());
  });

  test("drops the drive panel and the camera window inside the viewport", async ({
    page,
  }) => {
    // Both hang off a button 100–240 px from the right edge, so a 256–320 px
    // panel anchored to it would open past the left edge.
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

  test("opens the full-screen drive view from the panel, sticks in the bottom corners", async ({
    page,
  }) => {
    // The panel's two wells sit side by side in a 16rem card, under one
    // thumb; the drive view is where they come apart for two.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await page.getByRole("link", { name: "Open the full-screen drive view" }).click();
    await expect(page).toHaveURL(/\/drive$/);

    // One drive at a time: the strip does not offer the panel over the view.
    await expect(page.getByRole("button", { name: "Manual drive panel" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Arm manual drive input" })).toBeVisible();
    await expect(page.getByRole("slider", { name: "Max speed" })).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Console sections" });
    const navBox = await nav.boundingBox();
    const left = await page.getByRole("group", { name: "Translation stick" }).boundingBox();
    const right = await page.getByRole("group", { name: "Rotation stick" }).boundingBox();
    expect(navBox && left && right, "a stick or the nav has no box").toBeTruthy();
    if (!navBox || !left || !right) return;
    expect(left.x + left.width, "the translation stick is not on the left half").toBeLessThanOrEqual(WIDTH / 2);
    expect(right.x, "the rotation stick is not on the right half").toBeGreaterThanOrEqual(WIDTH / 2);
    for (const [name, box] of [["translation", left], ["rotation", right]] as const) {
      expect(box.width, `the ${name} stick is not thumb-sized`).toBeGreaterThanOrEqual(128);
      const bottom = box.y + box.height;
      expect(bottom, `the ${name} stick runs under the nav`).toBeLessThanOrEqual(navBox.y);
      expect(navBox.y - bottom, `the ${name} stick is not down by the nav`).toBeLessThan(80);
    }

    // And back to where the panel was opened.
    await page.getByRole("button", { name: "Leave the full-screen drive view" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("button", { name: "Manual drive panel" })).toBeVisible();
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("drives the view's translation stick one axis at a time, under its speed limit", async ({
    page,
  }) => {
    // A thumb on glass has no detent for straight ahead, so the translation
    // stick snaps to forward / back or strafe: frames never carry vx and vy
    // together, and the Max speed shown is the one they are sent at.
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
    const frames: { vx: number; vy: number; wz: number }[] = [];
    let sockets = 0;
    await page.routeWebSocket(/\/api\/v1\/robot\/teleop$/, (ws) => {
      sockets += 1;
      ws.onMessage((message) => {
        if (typeof message === "string") frames.push(JSON.parse(message));
      });
    });
    const last = () => frames.at(-1);

    await page.goto("/drive");
    await page.getByRole("switch", { name: "Arm manual drive input" }).click();
    // Connected: the fake took the socket and the panel stopped saying so.
    await expect.poll(() => sockets).toBe(1);
    await expect(page.getByText("Connecting to robot…")).toBeHidden();

    const well = (await page.getByRole("group", { name: "Translation stick" }).boundingBox())!;
    const cx = well.x + well.width / 2;
    const cy = well.y + well.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: { x: number; y: number }[]) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p) => ({ ...p, id: 1 })),
      });

    // Mostly up, a little right: forward only. The positive control is that
    // it drives at all.
    await touch("touchStart", [{ x: cx, y: cy }]);
    await touch("touchMove", [{ x: cx + 15, y: cy - 45 }]);
    await expect.poll(() => last()?.vx ?? 0).toBeGreaterThan(0);
    expect(last()?.vy).toBe(0);

    // Swung to mostly left without lifting: strafe left only.
    await touch("touchMove", [{ x: cx - 45, y: cy - 15 }]);
    await expect.poll(() => last()?.vy ?? 0).toBeGreaterThan(0);
    expect(last()?.vx).toBe(0);

    // Full left, then the limit halved with the thumb still down.
    await touch("touchMove", [{ x: cx - well.width, y: cy }]);
    await expect.poll(last).toEqual({ vx: 0, vy: 1, wz: 0 });
    const speed = page.getByRole("slider", { name: "Max speed" });
    await speed.focus();
    for (let step = 0; step < 5; step += 1) await page.keyboard.press("ArrowLeft");
    await expect(speed).toHaveAttribute("aria-valuetext", "50 percent of full speed");
    await expect.poll(last).toEqual({ vx: 0, vy: 0.5, wz: 0 });

    await touch("touchEnd", []);
    await expect.poll(last).toEqual({ vx: 0, vy: 0, wz: 0 });
    expect(
      frames.filter((f) => f.vx !== 0 && f.vy !== 0),
      "a diagonal reached the robot",
    ).toEqual([]);
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("drops the overheating notice inside the viewport", async ({ page }) => {
    // The sensor button is the leftmost of the three, so its panel would open
    // furthest past the left edge.
    await mockBackend(page, {
      state: robotState({
        motor_status: [{ name: "HL_Knee_joint", temperature: 90, error: 0 }],
      }),
    });
    await page.goto("/settings");

    const notice = page.getByRole("alert").filter({ hasText: "A motor is overheating" });
    await expect(notice).toBeVisible();
    await expectOnScreen(page, "the overheating notice", await notice.boundingBox());
    const dismiss = notice.getByRole("button", { name: "Dismiss" });
    const box = await dismiss.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(TARGET);
    expect(box?.height).toBeGreaterThanOrEqual(TARGET);
  });

  test("drops a goal draft when a second finger lands", async ({ page }) => {
    // A pinch with Set goal armed must not commit the first finger's aim —
    // a MOVE task to a spot nobody chose.
    //
    // The fake's bare {message} fails the ack schema, so for the positive
    // control this answers a real ack and a finished task for the poll.
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

    // Over CDP: page.touchscreen only knows a single tap, and the second
    // finger is the one under test.
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
    const body = dispatches[0] as { kind: string; steps: { type: string }[] };
    expect(body.steps[0].type).toBe("MOVE");
    // And it says what it is, which is what the history counts it as.
    expect(body.kind).toBe("goal");
  });

  test("zooms the editor's 3D view with two fingers, and places a waypoint with one", async ({
    page,
  }) => {
    // A 40×40 floor (4 m; see octomapBt). On a phone the heights panel hangs
    // down the left over the canvas's middle, so the fingers land on the
    // map's right half.
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: octomapBt(40),
      vertices: [],
    });
    await page.goto(`/maps/${MAP_NAME}/edit?view=3d`);
    const canvas = page.getByTestId("map-3d-canvas");
    await expect(canvas).toHaveAttribute("data-distance", /\d+/);
    const box = (await canvas.boundingBox())!;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      touchPoints: { x: number; y: number; id: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const distance = async () => Number(await canvas.getAttribute("data-distance"));

    // With Waypoint armed, fingers spreading zoom in and place nothing: the
    // second finger abandons what the first one planted.
    await page.getByRole("combobox", { name: "Draw" }).click();
    await page.getByRole("option", { name: "Waypoint", exact: true }).click();
    await page.getByRole("button", { name: "Place" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Create waypoint" });
    const opening = await distance();
    const a = { x: box.x + box.width * 0.62, y: cy };
    const b = { x: box.x + box.width * 0.82, y: cy };
    await touch("touchStart", [finger(a.x, a.y, 1)]);
    await touch("touchStart", [finger(a.x, a.y, 1), finger(b.x, b.y, 2)]);
    for (let step = 1; step <= 6; step += 1) {
      await touch("touchMove", [finger(a.x - 8 * step, a.y, 1), finger(b.x + 8 * step, b.y, 2)]);
    }
    await touch("touchEnd", [finger(a.x - 48, a.y, 1)]);
    await touch("touchEnd", []);
    await expect.poll(distance).toBeLessThan(opening);
    await expect(dialog).toHaveCount(0);

    // Positive control: one finger, pressed and lifted on the map, asks for
    // the new waypoint's name.
    await touch("touchStart", [finger(a.x, a.y, 1)]);
    await touch("touchEnd", []);
    await expect(dialog).toBeVisible();
  });

  test("zooms the 3D view with two fingers, and paints with one", async ({
    page,
  }) => {
    // A 40×40 floor (4 m) with a 2×2 hole in the middle (see octomapBt). On
    // a phone the readout panel hangs down the left over the canvas's
    // middle, so the fingers land on the map's right half.
    const size = 40;
    await mockBackend(page, {
      maps: [mapSummary(withOctomap())],
      octomap: octomapBt(size),
    });
    await page.goto(`/maps/${MAP_NAME}/edit?view=3d`);
    const canvas = page.getByTestId("map-3d-canvas");
    await expect(canvas).toHaveAttribute("data-distance", /\d+/);
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      touchPoints: { x: number; y: number; id: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const distance = async () => Number(await canvas.getAttribute("data-distance"));

    // Orbit is the opening tool; fingers spreading zoom in and paint nothing.
    const opening = await distance();
    const a = { x: box.x + box.width * 0.62, y: cy };
    const b = { x: box.x + box.width * 0.82, y: cy };
    await touch("touchStart", [finger(a.x, a.y, 1)]);
    await touch("touchStart", [finger(a.x, a.y, 1), finger(b.x, b.y, 2)]);
    for (let step = 1; step <= 6; step += 1) {
      await touch("touchMove", [finger(a.x - 8 * step, a.y, 1), finger(b.x + 8 * step, b.y, 2)]);
    }
    await touch("touchEnd", [finger(a.x - 48, a.y, 1)]);
    await touch("touchEnd", []);
    await expect.poll(distance).toBeLessThan(opening);
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

    // Positive control: one finger with Fill armed, half a metre east of the
    // hole with a 1 m brush, fills it. Fit first, so the camera is where the
    // metres are measured from: the screen row through the middle is the
    // map's middle row, half a metre there is (h / 2) / (d tan 30°) px each.
    await page.getByRole("button", { name: "Fit to view" }).click();
    await expect.poll(distance).toBe(opening);
    await page.getByRole("combobox", { name: "Draw" }).click();
    await page.getByRole("option", { name: "Ground patch", exact: true }).click();
    await page.getByRole("button", { name: "Fill" }).click();
    await page.getByRole("combobox", { name: "Brush radius" }).click();
    await page.getByRole("option", { name: "1.0 m", exact: true }).click();
    const pxPerM = box.height / 2 / ((opening / 100) * Math.tan(Math.PI / 6));
    await touch("touchStart", [finger(cx + 0.5 * pxPerM, cy, 1)]);
    await touch("touchEnd", []);
    await expect(page.locator("[data-patched]")).toHaveAttribute("data-patched", "4");
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("lays the floor plan editor's panels out without one covering the other", async ({
    page,
  }) => {
    // At 375 px a 224 px toolbar and a 240 px waypoint panel hung from the
    // top corners would overlap, covering the toolbar's Save.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 254) });
    await page.goto(`/maps/${MAP_NAME}/edit?mode=vertex`);
    await expect(page.getByRole("toolbar", { name: "Draw" })).toBeVisible();

    const save = await page.getByRole("button", { name: "Save" }).boundingBox();
    // .last(): the list header is the last "Waypoints" on the page.
    const waypoints = await page.getByText("Waypoints", { exact: true }).last().boundingBox();
    await expectOnScreen(page, "Save", save);
    await expectOnScreen(page, "the waypoint panel's heading", waypoints);
    expect(
      waypoints!.y,
      "the waypoint panel starts above the toolbar's Save",
    ).toBeGreaterThan(save!.y + save!.height);

    // Compact icons under a finger: named, but no printed label (innerText
    // skips what is not rendered; toContainText would not).
    const place = page.getByRole("button", { name: "Place" });
    await expect(place).toBeVisible();
    expect(await place.evaluate((el) => (el as HTMLElement).innerText.trim())).toBe("");
  });

  test("zooms the floor plan with two fingers instead of painting between them", async ({
    page,
  }) => {
    // With Brush armed, two fingers are a pinch, not a line painted from one
    // finger to the other.
    // A real 400 x 300 grid, since a pinch shrinks the 1 px default out from
    // under the fingers. Unknown cells, so painting Floor is a real change.
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

    // A pan press, then the pinch: how a phone looks around before painting.
    // exact: "Manual drive panel" in the strip contains the word.
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await touch("touchStart", [finger(cx - 30, cy, 1)]);
    await touch("touchStart", [finger(cx - 30, cy, 1), finger(cx + 30, cy, 2)]);
    await touch("touchMove", [finger(cx - 80, cy, 1), finger(cx + 80, cy, 2)]);
    await touch("touchEnd", [finger(cx - 80, cy, 1)]);
    await touch("touchEnd", []);
    // Nothing to save — and the map did zoom, or "nothing painted" would
    // also be true of a canvas that ignored the second finger. The zoom is
    // read off data-zoom, 94 at fit on this phone.
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    const zoom = page.locator("[data-zoom]");
    await expect.poll(async () => Number(await zoom.getAttribute("data-zoom"))).toBeGreaterThan(94);

    // Positive control: one finger with Brush armed does paint. Brush is
    // only offered once something is chosen to draw.
    await page.getByRole("combobox", { name: "Draw" }).click();
    await page.getByRole("option", { name: "Floor", exact: true }).click();
    await page.getByRole("button", { name: "Brush" }).click();
    await touch("touchStart", [finger(cx, cy, 1)]);
    await touch("touchMove", [finger(cx + 20, cy + 20, 1)]);
    await touch("touchEnd", []);
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  test("zooms the task editor's floor plan with two fingers", async ({ page }) => {
    // A phone has no wheel, so a pinch is how the floor plan is read up
    // close. A real grid, as above.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto("/tasks/editor");
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f/ });
    await expect(plan).toBeVisible();
    const zoom = page.locator("[data-zoom]");
    const readZoom = async () => Number(await zoom.getAttribute("data-zoom"));
    await expect.poll(readZoom).toBeGreaterThan(0);
    const fitted = await readZoom();

    // Centred first: the plan opens low on a phone, and its middle can sit
    // under the nav bar.
    await plan.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const box = (await plan.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      touchPoints: { x: number; y: number; id: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });

    // Control for the pinch below: one finger pans and leaves the zoom alone.
    await touch("touchStart", [finger(cx, cy, 1)]);
    await touch("touchMove", [finger(cx + 30, cy + 20, 1)]);
    await touch("touchEnd", []);
    expect(await readZoom()).toBe(fitted);

    // Two fingers spreading is a zoom.
    await touch("touchStart", [finger(cx - 30, cy, 1)]);
    await touch("touchStart", [finger(cx - 30, cy, 1), finger(cx + 30, cy, 2)]);
    await touch("touchMove", [finger(cx - 80, cy, 1), finger(cx + 80, cy, 2)]);
    await touch("touchEnd", [finger(cx - 80, cy, 1)]);
    await touch("touchEnd", []);
    await expect.poll(readZoom).toBeGreaterThan(fitted);
  });
  test("adds a stop for a finger's tap on a waypoint, and none for a pinch begun on one", async ({
    page,
  }) => {
    // The editor's map under a finger: the tap is the pick, and a second
    // finger turns the first into a pinch, which must not also be a pick.
    await mockBackend(page, { gridImage: floorPlanPng(400, 300, 205) });
    await page.goto("/tasks/editor");
    const plan = page.getByRole("img", { name: /^Floor plan of dp2f/ });
    await expect(plan).toBeVisible();
    await plan.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const box = (await plan.boundingBox())!;
    const meta = { resolution: 0.05, origin: [-12.3, -7.8, 0] as [number, number, number], width: 400, height: 300 };
    const at = vertexScreen(previewView({ width: box.width, height: box.height }, meta), meta, vertex().x, vertex().y);
    const sx = box.x + at.cx;
    const sy = box.y + at.cy;
    const cdp = await page.context().newCDPSession(page);
    const finger = (x: number, y: number, id: number) => ({ x, y, id });
    const touch = (
      type: "touchStart" | "touchMove" | "touchEnd",
      touchPoints: { x: number; y: number; id: number }[],
    ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const rows = page.locator("[data-stop]");

    // A pinch whose first finger is on the stop, ending where it began.
    await touch("touchStart", [finger(sx, sy, 1)]);
    await touch("touchStart", [finger(sx, sy, 1), finger(sx + 60, sy, 2)]);
    await touch("touchEnd", [finger(sx, sy, 1)]);
    await touch("touchEnd", []);
    await page.getByRole("button", { name: "Fit to view" }).click();
    await expect(rows).toHaveCount(0);

    // Control: one finger's tap on the same stop does add it.
    await touch("touchStart", [finger(sx, sy, 1)]);
    await touch("touchEnd", []);
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Waypoint for stop 1" })).toHaveText("dock");
  });
});
