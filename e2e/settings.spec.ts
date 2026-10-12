import { expect, test, type Page, type Route } from "@playwright/test";

import {
  failOnConsoleErrors,
  mockBackend,
  robotState,
  wifiConnection,
} from "./backend";

/**
 * The Settings header's restart: a press that rebuilds the robot's software,
 * whose outcome only the backend's restart record can report — the state
 * poll keeps answering with the last frame throughout.
 *
 * The console-error guard stays on, with one exception: a 409 makes Chromium
 * log "Failed to load resource", and here that refusal is the behaviour being
 * tested. A thrown render or a schema failure still fails the test.
 */
test.describe("restarting the robot from Settings", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(
      errors.filter((text) => !/Failed to load resource/.test(text)),
      "the page logged errors",
    ).toEqual([]);
  });

  // By its place in the page header: the dialog's confirm button carries the
  // same word, and is portalled outside <main>.
  const restartButton = (page: Page) =>
    page.locator("main header").getByRole("button", { name: "Restart", exact: true });

  /**
   * Answer GET /robot/restart with `record` once it is set, standing in for
   * the robot reporting back when its rebuild is over.
   */
  async function finishRestartWith(page: Page) {
    const finish: { record: Record<string, unknown> | null } = { record: null };
    await page.route("**/api/v1/robot/restart", (route: Route) =>
      route.request().method() === "GET" && finish.record
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(finish.record),
          })
        : route.fallback(),
    );
    return finish;
  }

  async function confirmRestart(page: Page) {
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Restart" }).click();
    return dialog;
  }

  test("confirms, restarts, and says so when the robot reports back", async ({
    page,
  }) => {
    const writes = await mockBackend(page);
    const finish = await finishRestartWith(page);

    await page.goto("/settings");
    await restartButton(page).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("stops navigating for about 30");

    // Nothing is sent until the operator confirms.
    expect(writes.filter((w) => w.path === "/api/v1/robot/restart")).toEqual([]);
    await dialog.getByRole("button", { name: "Restart" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();
    await expect(restartButton(page)).toBeDisabled();
    expect(
      writes.filter((w) => w.method === "POST" && w.path === "/api/v1/robot/restart"),
    ).toHaveLength(1);

    finish.record = {
      status: "succeeded",
      message: "Restarted AUTO (session auto)",
      started_at: "2026-09-18T09:45:00Z",
      finished_at: "2026-09-18T09:45:31Z",
    };
    // The console's own word, not the robot's sentence naming its session.
    await expect(page.getByText("Restart complete. The robot is back in Navigation.")).toBeVisible();
    await expect(page.getByText(/session auto/)).toHaveCount(0);
    await expect(restartButton(page)).toBeEnabled();
  });

  test("shows the robot's sentence when the rebuild fails", async ({ page }) => {
    await mockBackend(page);
    const finish = await finishRestartWith(page);

    await page.goto("/settings");
    await confirmRestart(page);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();

    const reason = "The robot did not report back from the restart. Check that it is running, then try again.";
    finish.record = {
      status: "failed",
      message: reason,
      started_at: "2026-09-18T09:45:00Z",
      finished_at: "2026-09-18T09:48:01Z",
    };
    await expect(page.getByText(reason)).toBeVisible();
    await expect(restartButton(page)).toBeEnabled();
  });

  test("shows a restart another console started, and holds the button", async ({
    page,
  }) => {
    await mockBackend(page, {
      restart: {
        status: "restarting",
        message: "",
        started_at: "2026-09-18T09:45:00Z",
        finished_at: null,
      },
    });
    await page.goto("/settings");

    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toBeVisible();
    await expect(restartButton(page)).toBeDisabled();
  });

  test("does not announce an old restart's outcome on arrival", async ({ page }) => {
    // Another console's restart, finished before this one opened Settings:
    // the operator here did not ask, so there is nothing to tell them.
    await mockBackend(page, {
      restart: {
        status: "failed",
        message: "Tried to restart AUTO but ended up in MAINTENANCE",
        started_at: "2026-09-18T09:00:00Z",
        finished_at: "2026-09-18T09:00:40Z",
      },
    });
    await page.goto("/settings");

    await expect(restartButton(page)).toBeEnabled();
    await expect(page.getByText(/ended up in MAINTENANCE/)).toHaveCount(0);
  });

  test("shows the robot's refusal and does not claim a restart", async ({
    page,
  }) => {
    await mockBackend(page);
    const refusal = "The robot cannot restart right now: both stacks are up.";
    await page.route("**/api/v1/robot/restart", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ detail: refusal, code: "restart_refused" }),
          })
        : route.fallback(),
    );

    await page.goto("/settings");
    const dialog = await confirmRestart(page);

    // The backend's sentence, verbatim, in the dialog that is still open.
    await expect(dialog.getByRole("alert")).toHaveText(refusal);
    await expect(page.getByText("Restarting. This takes about 30 seconds.")).toHaveCount(0);

    // And it is gone when the dialog is opened again.
    await dialog.getByRole("button", { name: "Keep running" }).click();
    await restartButton(page).click();
    await expect(page.getByRole("alertdialog").getByRole("alert")).toHaveCount(0);
  });

  test("warns that a running job will stop", async ({ page }) => {
    await mockBackend(page, {
      activeTasks: [
        {
          id: "robot01-task-1758000000-1",
          run_id: "run-1",
          status: "IN_PROGRESS",
          started_at: "2026-09-18T09:40:00Z",
          source: "DIRECT",
          schedule_id: null,
        },
      ],
    });
    await page.goto("/settings");
    await restartButton(page).click();
    await expect(page.getByRole("alertdialog")).toContainText(
      "running a job, and restarting stops it",
    );
  });

  test("cannot be pressed in Mapping, and says why", async ({ page }) => {
    const writes = await mockBackend(page, {
      state: robotState({ mode: "MANUAL" }),
    });
    await page.goto("/settings");

    await expect(restartButton(page)).toBeDisabled();
    await expect(restartButton(page)).toHaveAccessibleDescription(
      /Available in Navigation/,
    );
    expect(writes.filter((w) => w.path === "/api/v1/robot/restart")).toEqual([]);
  });
});

/**
 * The Settings landing is a card per section, each its own route; Restart
 * belongs to the landing alone.
 */
test.describe("settings sections", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  test("opens each section from its card and comes back", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/settings");

    const sections = page.getByRole("navigation", { name: "Settings sections" });
    await sections.getByRole("link", { name: /Wi-Fi/ }).click();
    await expect(page).toHaveURL(/\/settings\/wifi$/);
    await expect(page.getByRole("heading", { name: "Wi-Fi", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add network" })).toBeVisible();
    // The rail still marks Settings as the screen the operator is on.
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }).first(),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);

    await page.locator("main header").getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await sections.getByRole("link", { name: /Preferences/ }).click();
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  });

  test("says Planner and Controller are not available yet", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/settings");

    const sections = page.getByRole("navigation", { name: "Settings sections" });
    // Planner and Controller lead the grid, ahead of Wi-Fi.
    await expect(sections.getByRole("link")).toHaveText([
      /Planner/,
      /Controller/,
      /Wi-Fi/,
      /Preferences/,
    ]);

    for (const [name, path] of [
      ["Planner", "planner"],
      ["Controller", "controller"],
    ]) {
      await page.goto("/settings");
      await sections.getByRole("link", { name: new RegExp(name) }).click();
      await expect(page).toHaveURL(new RegExp(`/settings/${path}$`));
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(
        page.getByText(`${name} settings are not available on this robot yet.`),
      ).toBeVisible();
    }
  });
});

/**
 * Wi-Fi opens on the networks the robot has saved; a new one is joined from
 * Add network, one page further in. Every card that moves the robot is
 * checked against what the console sent, not only what the screen says.
 */
test.describe("Wi-Fi saved networks", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    expect(errors, "the page logged errors").toEqual([]);
  });

  const saved = (page: Page) =>
    page.getByRole("region", { name: "Saved networks" }).getByRole("listitem");

  test("lists the saved networks, the live one first and not forgettable", async ({
    page,
  }) => {
    await mockBackend(page, {
      // Listed out of order on purpose: the page orders them.
      wifiConnections: [
        wifiConnection({
          uuid: "9a1e-lab",
          name: "Lab",
          ssid: "lab-5g",
          active: false,
          last_used_at: null,
        }),
        wifiConnection(),
      ],
    });
    await page.goto("/settings/wifi");

    await expect(saved(page)).toHaveCount(2);
    const live = saved(page).first();
    await expect(live).toContainText("site-wifi");
    await expect(live).toContainText("Connected");
    await expect(live.getByRole("button")).toHaveCount(0);
    // The robot's link is read out on the live card itself.
    await expect(live).toContainText("-52 dBm");
    await expect(live).toContainText("10.8.140.138");
    await expect(live).toContainText("11:22:33:44:55:66");

    const other = saved(page).nth(1);
    await expect(other).toContainText("lab-5g");
    await expect(other).toContainText("Never joined");
    await expect(other).toContainText("Saved as Lab");
    await expect(other.getByRole("button", { name: "Connect to lab-5g" })).toBeEnabled();
    // Off the network, every row is a blank in its value's shape — never the
    // live network's address.
    await expect(other).toContainText("-- dBm");
    await expect(other).toContainText("--.--.--.--");
    await expect(other).toContainText("--:--:--:--:--:--");
    await expect(other).not.toContainText("10.8.140.138");
  });

  test("rejoins a saved network by its id, with no password", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings/wifi");

    await page.getByRole("button", { name: "Connect to lab-5g" }).click();

    await expect(page.getByText("Successfully connected to lab-5g")).toBeVisible();
    expect(writes).toContainEqual({
      method: "POST",
      path: "/api/v1/network/wifi/connections/9a1e-lab/activate",
      body: null,
    });
  });

  test("forgets a saved network only after asking", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings/wifi");

    await page.getByRole("button", { name: "Forget lab-5g" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Forget lab-5g?");
    await dialog.getByRole("button", { name: "Keep" }).click();
    await expect(dialog).toBeHidden();
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([]);

    await page.getByRole("button", { name: "Forget lab-5g" }).click();
    await dialog.getByRole("button", { name: "Forget" }).click();

    await expect(saved(page)).toHaveCount(1);
    expect(writes.filter((w) => w.method === "DELETE")).toEqual([
      { method: "DELETE", path: "/api/v1/network/wifi/connections/9a1e-lab", body: null },
    ]);
  });

  test("says so when nothing is saved", async ({ page }) => {
    await mockBackend(page, { wifiConnections: [] });
    await page.goto("/settings/wifi");

    await expect(page.getByText("No saved networks yet.")).toBeVisible();
  });

  test("adds a network from the scan and comes back to the list", async ({ page }) => {
    const writes = await mockBackend(page);
    await page.goto("/settings/wifi");

    await page.locator("main header").getByRole("link", { name: "Add network" }).click();
    await expect(page).toHaveURL(/\/settings\/wifi\/new$/);
    await expect(page.getByRole("heading", { name: "Add network", level: 1 })).toBeVisible();

    await page.getByRole("combobox", { name: "Network" }).click();
    await page.getByRole("option", { name: /guest/ }).click();
    await page.getByRole("textbox", { name: "Password" }).fill("hunter22");
    await page.getByRole("button", { name: "Connect" }).click();

    await expect(page).toHaveURL(/\/settings\/wifi$/);
    expect(writes).toContainEqual({
      method: "POST",
      path: "/api/v1/network/wifi/connect",
      body: { ssid: "guest", password: "hunter22" },
    });

    // And the way back from Add network is Wi-Fi, not Settings.
    await page.goto("/settings/wifi/new");
    await page.locator("main header").getByRole("link", { name: "Wi-Fi" }).click();
    await expect(page).toHaveURL(/\/settings\/wifi$/);
  });
});
