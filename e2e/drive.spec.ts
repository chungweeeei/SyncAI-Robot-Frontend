import { expect, test } from "@playwright/test";

import {
  failOnConsoleErrors,
  mockBackend,
} from "./backend";

/**
 * The manual drive panel.
 *
 * Each test asserts what the screen says *and* what the console sent: a
 * screen-only test passes a build that posts to the wrong endpoint.
 */
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
        .filter((w) => w.path === "/api/v1/robot/set_motion_key")
        .map((w) => (w.body as { key: string }).key);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await expect(
      page.getByRole("switch", { name: "Arm manual drive input" }),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Stand", exact: true }).click();
    await expect.poll(postures).toEqual(["0"]);
  });

  test("stands and lies down on R and F, but only while armed", async ({ page }) => {
    const errors: string[] = [];
    failOnConsoleErrors(page, errors);
    const writes = await mockBackend(page);
    // Held open: with no robot to connect to, the dropped channel disarms
    // the panel, and the keys go deaf with it.
    await page.routeWebSocket(/\/api\/v1\/robot\/teleop$/, () => {});
    const postures = () =>
      writes
        .filter((w) => w.path === "/api/v1/robot/set_motion_key")
        .map((w) => (w.body as { key: string }).key);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await expect(page.getByRole("heading", { name: "Manual drive" })).toBeVisible();

    // Disarmed, the keys are deaf, like the drive keys: a stray R must not
    // stand the robot up.
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    expect(postures()).toEqual([]);

    // Waits for the button to announce the key: the listener goes on with
    // the arm's render. F follows R at once, as a hand would: a request in
    // flight does not swallow the next key.
    const stand = page.getByRole("button", { name: "Stand", exact: true });
    const lieDown = page.getByRole("button", { name: "Lie down", exact: true });
    await page.getByRole("switch", { name: "Arm manual drive input" }).click();
    await expect(stand).toHaveAttribute("aria-keyshortcuts", "R");
    await page.keyboard.press("r");
    await expect(lieDown).toHaveAttribute("aria-keyshortcuts", "F");
    await page.keyboard.press("f");
    await expect.poll(postures).toEqual(["0", "2"]);

    // Disarmed again, deaf again: the positive control above is what makes
    // this silence mean something.
    await expect(stand).toHaveAttribute("aria-keyshortcuts", "R");
    await page.getByRole("switch", { name: "Arm manual drive input" }).click();
    await expect(stand).not.toHaveAttribute("aria-keyshortcuts", /./);
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    expect(postures()).toEqual(["0", "2"]);

    expect(errors, "the page logged errors").toEqual([]);
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
    let sockets = 0;
    await page.routeWebSocket(/\/api\/v1\/robot\/teleop$/, (ws) => {
      sockets += 1;
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
    // Connected: the fake took the socket and the panel stopped saying so.
    await expect.poll(() => sockets).toBe(1);
    await expect(page.getByText("Connecting to robot…")).toBeHidden();
    // Armed but untouched: nothing on the wire, since every frame is a
    // command the robot publishes. Several ticks' worth of quiet.
    await page.waitForTimeout(400);
    expect(frames).toEqual([]);

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
    // The release is one zero, and then the channel is quiet again.
    const sent = frames.length;
    await page.waitForTimeout(400);
    expect(frames.length).toBe(sent);
    expect(errors, "the page logged errors").toEqual([]);
  });
});
