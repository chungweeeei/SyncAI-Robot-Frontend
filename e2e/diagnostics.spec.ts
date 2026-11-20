import { expect, test } from "@playwright/test";

import { failOnConsoleErrors, mockBackend } from "./backend";

/**
 * Diagnostics' log export: the robot's last day of logs, saved to the
 * operator's machine. Both halves: what the screen says, and that the GET
 * went out and the file was handed over under the robot's name.
 */
test.describe("exporting the robot's logs", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(
      // The refusal test's 500 is the behaviour under test.
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  test("is reached from the rail, and saves the bundle under the robot's name", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/settings");
    await page
      .getByRole("navigation", { name: "Console sections" })
      .getByRole("link", { name: "Diagnostics" })
      .click();
    await expect(page).toHaveURL(/\/diagnostics$/);
    await expect(page.getByRole("heading", { name: "Diagnostics", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Logs" })).toBeVisible();

    const requested = page.waitForRequest(/\/api\/v1\/logs\/export$/);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export logs" }).click();

    expect((await requested).method()).toBe("GET");
    // The robot's own naming: <robot id>-logs-<UTC stamp>.tar.
    const filename = (await downloaded).suggestedFilename();
    expect(filename).toMatch(/^robot01-logs-\d{8}T\d{6}Z\.tar$/);
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText(
      `Saved ${filename} · 1 KiB`,
    );
    await expect(page.getByRole("button", { name: "Export logs" })).toBeEnabled();
  });

  test("says the robot's own sentence when it refuses, and saves nothing", async ({ page }) => {
    await mockBackend(page);
    await page.route(/\/api\/v1\/logs\/export$/, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "The robot could not gather its logs." }),
      }),
    );
    let saved = false;
    page.on("download", () => {
      saved = true;
    });
    await page.goto("/diagnostics");

    await page.getByRole("button", { name: "Export logs" }).click();
    // In <main>: Next's route announcer is an alert of its own.
    await expect(page.locator("main").getByRole("alert")).toHaveText(
      "The robot could not gather its logs.",
    );
    await expect(page.getByRole("button", { name: "Export logs" })).toBeEnabled();
    expect(saved).toBe(false);
  });
});
