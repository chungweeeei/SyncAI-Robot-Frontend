import { expect, test, type Page, type Route } from "@playwright/test";

import {
  failOnConsoleErrors,
  mockBackend,
  robotState,
  wifiConnection,
} from "./backend";

/**
 * The Settings restart: its outcome only the backend's restart record can
 * report, since the state poll keeps answering with the last frame.
 *
 * A 409 logs "Failed to load resource", and here that refusal is the
 * behaviour under test; a thrown render or schema failure still fails.
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

  /** Answer GET /robot/restart with `record` once set: the rebuild is over. */
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

    await page.locator("main header").getByRole("link", { name: "Go back" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await sections.getByRole("link", { name: /Preferences/ }).click();
    await expect(page).toHaveURL(/\/settings\/preferences$/);
    await expect(page.getByRole("combobox", { name: "Theme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart", exact: true })).toHaveCount(0);
  });

  test("puts Go back in the same top-right corner on every section", async ({ page }) => {
    // One frame for every section: the way up is where Wi-Fi's has always
    // been, beside the title and never over it, and it goes one level up.
    await mockBackend(page);
    let top: number | null = null;
    for (const [path, parent] of [
      ["/settings/planner", "/settings"],
      ["/settings/controller", "/settings"],
      ["/settings/wifi", "/settings"],
      ["/settings/preferences", "/settings"],
      ["/settings/wifi/new", "/settings/wifi"],
    ]) {
      await page.goto(path);
      const header = page.locator("main header");
      const back = header.getByRole("link", { name: /^Go back to / });
      await expect(back, path).toHaveCount(1);
      await expect(back, path).toHaveAttribute("href", parent);

      const title = (await header.getByRole("heading", { level: 1 }).boundingBox())!;
      const box = (await back.boundingBox())!;
      expect(box.x, `${path}: Go back is not right of the title`).toBeGreaterThan(
        title.x + title.width,
      );
      // The frame is one width and one header, so the row does not move
      // between sections.
      top ??= box.y;
      expect(Math.abs(box.y - top), `${path}: Go back is not on the same row`).toBeLessThan(2);
    }

    // The landing has no way up, only its restart in that corner.
    await page.goto("/settings");
    await expect(page.locator("main header").getByRole("link", { name: /Go back/ })).toHaveCount(0);
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
 * Add network, one page further in.
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

  test("greys every other Wi-Fi change while one is in flight", async ({ page }) => {
    await mockBackend(page, {
      wifiConnections: [
        wifiConnection(),
        wifiConnection({ uuid: "9a1e-lab", name: "lab-5g", ssid: "lab-5g", active: false }),
        wifiConnection({ uuid: "77b0-dock", name: "dock", ssid: "dock", active: false }),
      ],
    });
    // The rejoin hangs until released, as a real one does for up to a minute.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/v1/network/wifi/connections/9a1e-lab/activate", async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: "Successfully connected to lab-5g" }),
      });
    });
    await page.goto("/settings/wifi");

    await page.getByRole("button", { name: "Connect to lab-5g" }).click();

    // The robot takes one change at a time, so the other card's buttons wait.
    await expect(page.getByRole("button", { name: "Connect to dock" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Forget dock" })).toBeDisabled();

    release();
    await expect(page.getByText("Successfully connected to lab-5g")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect to dock" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Forget dock" })).toBeEnabled();
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
    await page
      .locator("main header")
      .getByRole("link", { name: "Go back to Wi-Fi", exact: true })
      .click();
    await expect(page).toHaveURL(/\/settings\/wifi$/);
  });
});

/**
 * A Wi-Fi change refused because another is still running on the robot —
 * another console's, since this one greys its own. The refusal logs "Failed
 * to load resource"; that 409 is the behaviour under test.
 */
test.describe("Wi-Fi changes another console is making", () => {
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

  test("shows the robot's busy sentence on the card that asked", async ({ page }) => {
    const sentence =
      "The robot is already changing its WiFi connection; wait for that to finish.";
    await mockBackend(page);
    await page.route("**/api/v1/network/wifi/connections/9a1e-lab/activate", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: sentence, code: "wifi_busy" }),
      }),
    );
    await page.goto("/settings/wifi");

    await page.getByRole("button", { name: "Connect to lab-5g" }).click();

    const card = page
      .getByRole("region", { name: "Saved networks" })
      .getByRole("listitem")
      .filter({ hasText: "lab-5g" });
    await expect(card.getByRole("alert")).toHaveText(sentence);
    // Nothing is heading anywhere, and the press can be made again.
    await expect(card).not.toContainText("Connecting to");
    await expect(page.getByRole("button", { name: "Connect to lab-5g" })).toBeEnabled();
  });
});
