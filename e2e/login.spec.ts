import { expect, test, type Page } from "@playwright/test";

import {
  E2E_PASSWORD,
  E2E_RENEWED_TOKEN,
  E2E_TOKEN,
  E2E_USERNAME,
  failOnConsoleErrors,
  mockBackend,
} from "./backend";

/**
 * The sign-in: the console is behind it, every request carries its token,
 * and a session ends — by a 401, at its expiry, or by Sign out — back on
 * /login, remembering the screen it left.
 */
test.describe("the sign-in", () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = [];
    failOnConsoleErrors(page, errors);
  });

  test.afterEach(() => {
    // A refused request, or one the network dropped, is logged by the
    // browser itself; it is what these tests make happen, not a fault in the
    // page.
    const faults = errors.filter((text) => !/status of 401|net::ERR_FAILED/.test(text));
    expect(faults, "the page logged errors").toEqual([]);
  });

  async function signIn(page: Page, password = E2E_PASSWORD) {
    await page.getByLabel("Username").fill(E2E_USERNAME);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }

  test("sends a signed-out operator to /login and back to the screen they asked for", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { signedIn: false });
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    // No shell, and so no stop or poll, before there is a token to ask with.
    await expect(page.getByRole("navigation", { name: "Console sections" })).toHaveCount(0);

    const stateRead = page.waitForRequest("**/api/v1/robot/state");
    await signIn(page);
    await expect(page).toHaveURL(/\/tasks$/);
    expect((await stateRead).headers()["authorization"]).toBe(`Bearer ${E2E_TOKEN}`);
    expect(writes).toContainEqual({
      method: "POST",
      path: "/api/v1/auth/login",
      body: { username: E2E_USERNAME, password: E2E_PASSWORD },
    });
  });

  test("says the backend's sentence for a wrong password and stays", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/login");
    await signIn(page, "wrong");
    await expect(page.getByText("Wrong username or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    // Ready for the retry: the name kept, the password emptied and focused.
    await expect(page.getByLabel("Username")).toHaveValue(E2E_USERNAME);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  });

  test("says which field is empty instead of greying Sign in, and sends nothing", async ({
    page,
  }) => {
    const writes = await mockBackend(page, { signedIn: false });
    await page.goto("/login");

    const signInButton = page.getByRole("button", { name: "Sign in" });
    await expect(signInButton).toBeEnabled();
    await signInButton.click();
    await expect(page.getByText("Enter your username.")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeFocused();

    await page.getByLabel("Username").fill(E2E_USERNAME);
    await expect(page.getByText("Enter your username.")).toHaveCount(0);
    await signInButton.click();
    await expect(page.getByText("Enter your password.")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    expect(writes.filter((w) => w.path === "/api/v1/auth/login")).toEqual([]);
  });

  test("carries the token on the streams, where a header cannot go", async ({ page }) => {
    await mockBackend(page);
    const urls: string[] = [];
    await page.routeWebSocket(/\/api\/v1\/robot\/teleop(\?|$)/, (ws) => {
      urls.push(ws.url());
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Manual drive panel" }).click();
    await page.getByRole("switch", { name: "Arm manual drive input" }).click();
    await expect.poll(() => urls.length).toBe(1);
    expect(new URL(urls[0]).searchParams.get("token")).toBe(E2E_TOKEN);
  });

  test("ends the session when the robot refuses its token", async ({ page }) => {
    await mockBackend(page);
    let refuse = false;
    await page.route("**/api/v1/robot/state", (route) =>
      refuse
        ? route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ detail: "Your session has ended. Sign in again." }),
          })
        : route.fallback(),
    );
    await page.goto("/history");
    await expect(page.getByRole("navigation", { name: "Console sections" })).toBeVisible();

    refuse = true;
    await expect(page).toHaveURL(/\/login\?next=%2Fhistory$/);
    expect(await page.evaluate(() => localStorage.getItem("auth.session"))).toBeNull();
  });

  test("renews an open console's session before it expires, and keeps going", async ({
    page,
  }) => {
    await page.clock.install();
    const writes = await mockBackend(page, { signedIn: false });
    await page.goto("/login");
    await signIn(page);
    await expect(page).toHaveURL(/\/$/);

    // The fake answers expires_in: 3600; the renewal is due a quarter short.
    await page.clock.fastForward("45:01");
    await expect
      .poll(() => writes.filter((w) => w.path === "/api/v1/auth/refresh").length)
      .toBe(1);
    // Past the first token's expiry, still signed in, asking with the new one.
    await page.clock.fastForward("20:00");
    const stateRead = page.waitForRequest("**/api/v1/robot/state");
    await page.clock.fastForward("00:02");
    expect((await stateRead).headers()["authorization"]).toBe(`Bearer ${E2E_RENEWED_TOKEN}`);
    await expect(page).toHaveURL(/\/$/);
  });

  test("signs out when the robot will not renew the session any more", async ({ page }) => {
    await page.clock.install();
    await mockBackend(page, { signedIn: false });
    await page.route("**/api/v1/auth/refresh", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Your session has ended. Sign in again." }),
      }),
    );
    await page.goto("/login");
    await signIn(page);
    await expect(page).toHaveURL(/\/$/);

    await page.clock.fastForward("45:01");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("ends the session at its expiry when no renewal lands", async ({ page }) => {
    await page.clock.install();
    await mockBackend(page, { signedIn: false });
    // The robot unreachable for the renewal and every retry.
    await page.route("**/api/v1/auth/refresh", (route) => route.abort());
    await page.goto("/login");
    await signIn(page);
    await expect(page).toHaveURL(/\/$/);

    await page.clock.fastForward("45:01");
    await expect(page).toHaveURL(/\/$/);
    await page.clock.fastForward("15:00");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signs out from the rail", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/maps");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Fmaps$/);
    expect(await page.evaluate(() => localStorage.getItem("auth.session"))).toBeNull();
  });

  test("leaves /login for the dashboard when already signed in", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
  });
});
