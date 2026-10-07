import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  robotState,
  taskState,
} from "./backend";

/**
 * The masthead's emergency stop: one press engages it, only a held press
 * releases it. Each test asserts both halves — what the strip says and what
 * the console sent — and every "nothing happened" carries a positive control,
 * because a button that never received the press also leaves the stop where
 * it was.
 */

const ID = "robot01-task-1758000000-1";

const strip = (page: Page) => page.getByRole("banner");
const stopButton = (page: Page) =>
  strip(page).getByRole("button", { name: /^Emergency stop/ });

/** Press the stop with the mouse and hold it for `ms`. */
async function holdStop(page: Page, ms: number) {
  const box = await stopButton(page).boundingBox();
  if (!box) throw new Error("the stop is not on screen");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe("the emergency stop", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("one press sends the stop and cancels the running job", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [ID]: taskState() },
    });
    await page.goto("/settings");
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(strip(page).getByRole("status")).toContainText("2/3");

    await stopButton(page).click();

    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => writes.map((w) => `${w.method} ${w.path}`).sort())
      .toEqual(["DELETE /api/v1/tasks/" + ID, "POST /api/v1/robot/set_motion_key"]);
    expect(writes.find((w) => w.method === "POST")?.body).toEqual({ key: "4" });

    // The robot's side holds the motor stop back today, and the operator
    // has to be able to find out the motors were not stopped — on the
    // hover and the description, never as a line under the strip.
    await expect(stopButton(page)).toHaveAttribute(
      "title",
      /Its motors are still powered/,
    );
    await expect(stopButton(page)).toHaveAccessibleDescription(
      /Its motors are still powered/,
    );
    await expect(strip(page).getByRole("alert")).toHaveCount(0);
  });

  test("a tap does not release it; a held press does", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/settings");

    await stopButton(page).click();
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");

    // A second tap, and a press let go early: both leave it engaged.
    await stopButton(page).click();
    await holdStop(page, 300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");

    // Positive control: the same press held past the second releases it.
    await holdStop(page, 1300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(stopButton(page)).not.toHaveAttribute("title", /motors/);
  });

  test("Shift+Space engages it from anywhere on the page", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings");

    await page.keyboard.press("Shift+Space");

    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/robot/set_motion_key"))
      .toHaveLength(1);
  });

  test("disarms manual drive and keeps it disarmed until released", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings");
    await strip(page).getByRole("button", { name: "Manual drive panel" }).click();
    const arm = page.getByRole("switch", { name: "Arm manual drive input" });

    // Positive control: the switch arms before the stop.
    await arm.click();
    await expect(arm).toHaveAttribute("aria-checked", "true");

    await stopButton(page).click();
    await expect(arm).toHaveAttribute("aria-checked", "false");
    await expect(arm).toHaveAttribute("aria-disabled", "true");

    // Released, it may be armed again — but it was not re-armed for us.
    await holdStop(page, 1300);
    await expect(arm).toHaveAttribute("aria-checked", "false");
    await arm.click();
    await expect(arm).toHaveAttribute("aria-checked", "true");
  });

  test("shows a stop the robot reports, and does not offer to release it", async ({
    page,
  }) => {
    const writes = await mockBackend(page, {
      state: robotState({ low_level_mode: { policy: "PPO", motion: "ESTOP" } }),
    });
    await page.goto("/settings");

    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    await holdStop(page, 1300);
    await expect(stopButton(page)).toHaveAttribute("aria-pressed", "true");
    // Pressing an engaged stop sends nothing.
    expect(writes).toEqual([]);
  });
});
