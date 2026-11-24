import { expect, test, type Page } from "@playwright/test";

import { failOnConsoleErrors, mockBackend, robotState } from "./backend";

/** Every robot model the page has asked for, by file name. */
function modelRequests(page: Page): string[] {
  const asked: string[] = [];
  page.on("request", (request) => {
    const match = /\/models\/([a-z0-9]+)\.glb$/.exec(new URL(request.url()).pathname);
    if (match) asked.push(match[1]);
  });
  return asked;
}

/**
 * One console image serves every robot: which machine it draws, and where
 * that machine's motors sit in the motor grid, come from the model the robot
 * reports, on its state and, before sign-in, on its liveness answer.
 */
test.describe("the robot's model", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("draws an M20 and lays out its wheels for a robot that says it is one", async ({
    page,
  }) => {
    const asked = modelRequests(page);
    await mockBackend(page, {
      state: robotState({
        robot_model: "m20",
        motor_status: [
          { name: "fl_knee_joint", temperature: 41, error: 0 },
          { name: "hr_wheel_joint", temperature: 37, error: 0 },
        ],
      }),
    });
    const model = page.waitForRequest("**/models/m20.glb");
    await page.goto("/");
    await model;

    const telemetry = page.getByRole("complementary", { name: "Telemetry" });
    await telemetry.getByRole("button", { name: "Show motor temperatures" }).click();
    // A row per leg, and both readings in the grid rather than under it.
    await expect(telemetry.getByText("Wheel", { exact: true })).toHaveCount(4);
    await expect(telemetry.getByText("37")).toBeVisible();
    await expect(telemetry.getByText(/Other motor/)).toHaveCount(0);
    await expect(telemetry.getByText(/_joint/)).toHaveCount(0);
    expect(asked).not.toContain("g23");
  });

  test("draws a G23, with no wheel rows, for a robot that says it is one", async ({ page }) => {
    const asked = modelRequests(page);
    await mockBackend(page, { state: robotState({ robot_model: "g23" }) });
    const model = page.waitForRequest("**/models/g23.glb");
    await page.goto("/");
    await model;

    const telemetry = page.getByRole("complementary", { name: "Telemetry" });
    await telemetry.getByRole("button", { name: "Show motor temperatures" }).click();
    await expect(telemetry.getByText("Knee", { exact: true })).toHaveCount(4);
    await expect(telemetry.getByText("Wheel", { exact: true })).toHaveCount(0);
    expect(asked).not.toContain("m20");
  });

  test("draws no robot it has no picture of, and still lists its motors", async ({ page }) => {
    const asked = modelRequests(page);
    await mockBackend(page, {
      state: robotState({
        robot_model: "x99",
        motor_status: [{ name: "fl_knee_joint", temperature: 52, error: 0 }],
      }),
    });
    await page.goto("/");

    const telemetry = page.getByRole("complementary", { name: "Telemetry" });
    await telemetry.getByRole("button", { name: "Show motor temperatures" }).click();
    await expect(telemetry.getByText("Front left knee", { exact: true })).toBeVisible();
    await expect(telemetry.getByText(/_joint/)).toHaveCount(0);
    expect(asked).toEqual([]);
  });

  test("draws the robot's own model on the sign-in screen, before there is a token", async ({
    page,
  }) => {
    const asked = modelRequests(page);
    await mockBackend(page, { signedIn: false, state: robotState({ robot_model: "m20" }) });
    const health = page.waitForRequest((request) => new URL(request.url()).pathname === "/health");
    const model = page.waitForRequest("**/models/m20.glb");
    await page.goto("/login");

    expect((await health).headers()["authorization"]).toBeUndefined();
    await model;
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(asked).not.toContain("g23");
  });
});
