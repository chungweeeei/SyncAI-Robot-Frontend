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

  test("reaches every operator screen from the rail", async ({ page }) => {
    await page.goto("/");

    for (const [name, heading] of [
      ["Maps", "Maps"],
      ["Recordings", "Recordings"],
      ["Tasks", "Tasks"],
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

  test("keeps the WebRTC bench out of a production build", async ({ page }) => {
    // The bench asks for the microphone and the camera, and nothing but the
    // URL is needed to open it — so on the robot it must not open at all.
    await mockBackend(page);
    const response = await page.goto("/webrtc-test");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/could not be found/i)).toBeVisible();
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
