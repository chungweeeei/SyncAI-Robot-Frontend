import { expect, test, type Page } from "@playwright/test";

import {
  activeTask,
  failOnConsoleErrors,
  mockBackend,
  robotState,
  taskState,
} from "./backend";

/**
 * The dashboard's Auto localize: one press asks the robot to find itself on
 * the map, and the read-back under the left strip says how that went. Each
 * test asserts both halves — what the panel says and what the console sent —
 * and every greyed button is checked against a write log that stayed empty.
 */

const button = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Viewport" })
    .getByRole("button", { name: "Auto localize" });
const readBack = (page: Page) =>
  page.getByRole("status", { name: "Auto localize" });

const posts = (writes: { path: string }[]) =>
  writes.filter((w) => w.path === "/api/v1/localization/auto");

test.describe("auto localize", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  // The refusal test answers with a 502 on purpose, which Chromium logs as
  // "Failed to load resource" (estop.spec.ts records the same exception).
  test.afterEach(() => {
    expect(
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  test("one press finds the robot and reads back where", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/");

    await button(page).click();

    await expect.poll(() => posts(writes)).toEqual([
      { method: "POST", path: "/api/v1/localization/auto", body: null },
    ]);
    await expect(readBack(page)).toContainText("Localized");
    await expect(readBack(page)).toContainText("1.25");
    await expect(readBack(page)).toContainText("-3.50");
    await expect(readBack(page)).toContainText("90.0");
    await expect(readBack(page)).toContainText("87");
  });

  test("shows the search while it runs and blocks a second press", async ({
    page,
  }) => {
    const writes = await mockBackend(page);
    let answer: () => void = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    await page.route("**/api/v1/localization/auto", async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto("/");

    await button(page).click();

    await expect(readBack(page)).toContainText("Searching");
    await expect(button(page)).toBeDisabled();
    answer();
    await expect(readBack(page)).toContainText("Localized");
    expect(posts(writes)).toHaveLength(1);
  });

  test("a refusal is the backend's sentence, with a retry", async ({ page }) => {
    await mockBackend(page);
    const sentence =
      "search failed: ambiguous, a distinct pose scores alike";
    // Counted here: the refused press never reaches the fake's write log.
    let presses = 0;
    let refuse = true;
    await page.route("**/api/v1/localization/auto", (route) => {
      presses += 1;
      return refuse
        ? route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ detail: sentence }),
          })
        : route.fallback();
    });
    await page.goto("/");

    await button(page).click();

    await expect(readBack(page)).toContainText("Failed");
    await expect(readBack(page)).toContainText(sentence);

    refuse = false;
    await readBack(page).getByRole("button", { name: "Retry" }).click();
    await expect(readBack(page)).toContainText("Localized");
    expect(presses).toBe(2);
  });

  test("is greyed while a job runs", async ({ page }) => {
    const id = "robot01-task-1758000000-1";
    const writes = await mockBackend(page, {
      activeTasks: [activeTask()],
      taskStates: { [id]: taskState() },
    });
    await page.goto("/");

    await expect(button(page)).toBeDisabled();
    await button(page).click({ force: true });
    expect(posts(writes)).toEqual([]);
  });

  test("is greyed in Mapping mode", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: robotState({ mode: "MANUAL" }),
    });
    await page.goto("/");

    await expect(button(page)).toBeDisabled();
    await button(page).click({ force: true });
    expect(posts(writes)).toEqual([]);
  });
});
