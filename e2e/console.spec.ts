import { expect, test } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/**
 * The shell: every screen loads, the rail navigates, and the header agrees
 * with the page because both read the one robot-state poll.
 */
test.describe("the console shell", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
    await mockBackend(page);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("opens the dashboard with the robot's telemetry rail", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Telemetry" })).toBeVisible();
    // The battery comes off the same frame the header reads.
    await expect(page.getByText("88")).toBeVisible();
  });

  test("opens the drive panel from the masthead on a screen with no viewport", async ({
    page,
  }) => {
    // The panel used to be mounted by the three viewport screens, so /settings
    // was one of the places an operator could not nudge the robot from. It
    // comes up collapsed and disarmed: opening it must not start anything.
    await page.goto("/settings");
    const toggle = page.getByRole("button", { name: "Manual drive panel" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.getByRole("heading", { name: "Manual drive" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Arm manual drive input" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await toggle.click();
    await expect(page.getByRole("heading", { name: "Manual drive" })).toHaveCount(0);
  });

  test("offers no way to save a clip before there is a picture", async ({
    page,
  }) => {
    // The fake backend cannot complete an ICE handshake, so the window never
    // reaches a live picture -- which is exactly the state worth pinning: a
    // control that offered to save one would be offering to save nothing.
    await page.goto("/settings");
    const toggle = page.getByRole("button", { name: "Camera window" });
    await toggle.click();

    const clip = page.getByRole("button", { name: "Video clip" });
    await expect(clip).toBeDisabled();
    await expect(clip).toHaveAttribute("aria-pressed", "false");

    // And the disclosure still closes the way it did before the window grew a
    // second control: Escape is scoped to this subtree, not to the window.
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("moves the camera window from the keyboard and puts it back", async ({
    page,
  }) => {
    // Resizing already had a keyboard path. Moving did not, so a keyboard user
    // who made the window bigger could not put it out of the way.
    await page.goto("/settings");
    await page.getByRole("button", { name: "Camera window" }).click();
    const handle = page.getByRole("button", { name: "Move the camera window" });
    const panel = page.locator("div", { has: handle }).last();
    const start = (await panel.boundingBox())!;

    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!;
        return [Math.round(box.x - start.x), Math.round(box.y - start.y)];
      })
      .toEqual([-16, 16]);

    // Home is the keyboard's double-click on the header: back where it opened.
    await page.keyboard.press("Home");
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!;
        return [Math.round(box.x - start.x), Math.round(box.y - start.y)];
      })
      .toEqual([0, 0]);
  });

  test("names every row of choices for a screen reader", async ({ page }) => {
    // A segment is an aria-pressed button, so without a named group around it
    // a reader hears "Move, button, pressed" and nothing about what Move is.
    await page.goto("/");
    const camera = page.getByRole("group", { name: "Camera" });
    await expect(camera.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.getByRole("link", { name: "History" }).click();
    await expect(page.getByRole("group", { name: "Outcome" })).toBeVisible();
  });

  test("names every viewport icon, and says what an armed tool wants next", async ({
    page,
  }) => {
    // The toolbar is icons, so a name has to come from somewhere other than
    // the glyph: the accessible name, and a tooltip on hover.
    await page.goto("/");
    const toolbar = page.getByRole("toolbar", { name: "Viewport" });
    for (const name of [
      "Set goal",
      "Set initial pose",
      "Move",
      "Focus",
      "Top down",
      "Zoom in",
      "Zoom out",
    ]) {
      await expect(toolbar.getByRole("button", { name })).toBeVisible();
    }
    // The left strip is what is done to the map itself; the stream pill that
    // used to sit opposite the toolbar is gone.
    const mapTools = page.getByRole("toolbar", { name: "Map" });
    for (const name of ["Recenter", "Add waypoint"]) {
      await expect(mapTools.getByRole("button", { name })).toBeVisible();
    }
    await expect(page.getByText("Scan live")).toHaveCount(0);
    const goal = toolbar.getByRole("button", { name: "Set goal" });
    await goal.hover();
    await expect(page.getByText("— drag on the map to aim, release to send")).toBeVisible();

    // Once the pointer has gone to the map the tooltip is gone, so the next
    // step is spelled out under the toolbar while the tool is armed.
    const hint = page.getByRole("status").filter({ hasText: "Aim and release to send" });
    await goal.click();
    await expect(goal).toHaveAttribute("aria-pressed", "true");
    await expect(hint).toBeVisible();

    // One pick mode: arming the other pose tool disarms this one.
    const pose = toolbar.getByRole("button", { name: "Set initial pose" });
    await pose.click();
    await expect(pose).toHaveAttribute("aria-pressed", "true");
    await expect(goal).toHaveAttribute("aria-pressed", "false");
    await expect(hint).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Press the map, then drag to aim" }),
    ).toBeVisible();

    await pose.click();
    await expect(pose).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status").filter({ hasText: "drag to aim" })).toHaveCount(0);
  });

  test("keeps one pick mode across both strips", async ({ page }) => {
    // Add waypoint sits in the other strip but is the same kind of tool as
    // Set goal, and one pick mode still means one: arming either disarms the
    // other. Its own test because every click on this page costs the
    // software-rendered viewport a couple of seconds, and the icon test above
    // is already close to the budget.
    await page.goto("/");
    const goal = page.getByRole("toolbar", { name: "Viewport" }).getByRole("button", { name: "Set goal" });
    const place = page.getByRole("toolbar", { name: "Map" }).getByRole("button", { name: "Add waypoint" });

    await goal.click();
    await expect(goal).toHaveAttribute("aria-pressed", "true");
    await place.click();
    await expect(place).toHaveAttribute("aria-pressed", "true");
    await expect(goal).toHaveAttribute("aria-pressed", "false");
    // Add waypoint carries no hint under the strips: the lit button and the
    // marker under the pointer are the whole read-back until the dialog.
    await expect(page.getByRole("status").filter({ hasText: "drag to aim" })).toHaveCount(0);

    await goal.click();
    await expect(place).toHaveAttribute("aria-pressed", "false");
    await expect(goal).toHaveAttribute("aria-pressed", "true");
  });

  test("reaches every operator screen from the rail", async ({ page }) => {
    await page.goto("/");
    // Wait for the dashboard to be up before the first click. A click that
    // lands while the page is still hydrating can be swallowed, leaving the
    // test on "/", and each link added to the rail made that window wider.
    await expect(page.getByRole("region", { name: "Map viewport" })).toBeVisible();
    await expect(page.getByText("robot01").first()).toBeVisible();

    for (const [name, heading] of [
      ["Maps", "Maps"],
      ["Recordings", "Recordings"],
      ["Tasks", "Tasks"],
      ["History", "History"],
      ["Settings", "Settings"],
    ] as const) {
      await page.getByRole("link", { name }).click();
      await expect(
        page.getByRole("heading", { name: heading, level: 1 }),
      ).toBeVisible();
    }

    await page.getByRole("link", { name: "Mapping" }).click();
    await expect(
      page.getByRole("region", { name: "Mapping viewport" }),
    ).toBeVisible();
  });

  test("keeps the robot id the header read on every screen", async ({ page }) => {
    // One poll for the whole console: the header and the page cannot disagree
    // because there is only one frame to disagree about.
    await page.goto("/maps");
    await expect(page.getByText("robot01").first()).toBeVisible();
    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByText("robot01").first()).toBeVisible();
  });

});

/**
 * Outside the console-error guard above on purpose: navigating to a 404 makes
 * the browser log a failed document load, which is the correct behaviour being
 * asserted rather than noise to suppress.
 */
test.describe("routes that must not exist on the robot", () => {
  test("404s a route that was removed", async ({ page }) => {
    await mockBackend(page);
    const response = await page.goto("/model-preview");
    expect(response?.status()).toBe(404);
  });
});

/**
 * Also outside the console-error guard: the bench talks to a WebRTC backend
 * this suite does not fake, so it logs what a missing one looks like. What is
 * asserted here is only that the route exists in a production build — it used
 * to 404 in one, which put it out of reach on the robot, the only machine that
 * can exercise the video path.
 */
test.describe("the WebRTC bench", () => {
  test("renders in a production build", async ({ page }) => {
    await mockBackend(page);
    const response = await page.goto("/webrtc-test");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Camera idle" })).toBeVisible();
  });
});

test.describe("when the robot has not localized", () => {
  test("says so rather than showing empty instruments", async ({ page }) => {
    // GET /robot/state 404s until the localizer converges, and a dashboard
    // that rendered zeros then would be stating a pose the robot does not have.
    await mockBackend(page, { state: null });
    await page.goto("/");
    await expect(page.getByText("No signal from the robot")).toBeVisible();
    await expect(
      page.getByText("This console cannot reach the robot."),
    ).toBeVisible();
    // Written for whoever is standing next to the robot: the things they can
    // check without a terminal, and no endpoint or service name.
    await expect(page.getByText(/powered on/)).toBeVisible();
    await expect(page.getByText(/api\/v1/)).toHaveCount(0);
  });

  test("still lets the operator reach Settings to fix the network", async ({
    page,
  }) => {
    await mockBackend(page, { state: null });
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("when the backend answers in a shape the console does not know", () => {
  test("fails loudly at the boundary instead of rendering nonsense", async ({
    page,
  }) => {
    // The whole point of the zod layer: a renamed field used to arrive as
    // `undefined` and surface pages later as a blank readout.
    await mockBackend(page, {
      state: { ...robotState(), battery_status: { percentage: 88 } },
    });
    await page.goto("/");
    // The state query errors, so the dashboard shows its no-signal gate rather
    // than a rail full of holes.
    await expect(page.getByText("No signal from the robot")).toBeVisible();
  });
});
