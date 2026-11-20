import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { login, refreshSession } from "@/lib/api/auth";
import { sessionStore } from "@/lib/auth/session";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("times the session by expires_in on this machine's clock, not the robot's expires_at", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        // A robot whose clock is a day behind.
        JSON.stringify({
          access_token: "tok",
          token_type: "bearer",
          expires_at: 1000,
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const session = await login({ username: "admin", password: "pw" }, () => 5_000_000);
    expect(session).toEqual({
      token: "tok",
      username: "admin",
      issuedAt: 5_000_000,
      expiresAt: 5_000_000 + 3_600_000,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/login$/);
    expect(JSON.parse(init.body as string)).toEqual({ username: "admin", password: "pw" });
  });

  it("throws the backend's sentence for a wrong password", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Wrong username or password." }), { status: 401 }),
    );
    await expect(login({ username: "admin", password: "x" })).rejects.toThrow(
      "Wrong username or password.",
    );
  });
});

describe("refreshSession", () => {
  afterEach(() => sessionStore().clear());

  it("sends the token it holds and keeps the name, timing the new one on this clock", async () => {
    sessionStore().set({ token: "old", username: "admin", issuedAt: 0, expiresAt: 9e15 });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "new", token_type: "bearer", expires_at: 1, expires_in: 600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const session = await refreshSession("admin", () => 7_000);
    expect(session).toEqual({ token: "new", username: "admin", issuedAt: 7_000, expiresAt: 607_000 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/refresh$/);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer old");
  });

  it("ends the session when the robot refuses to renew it", async () => {
    sessionStore().set({ token: "old", username: "admin", issuedAt: 0, expiresAt: 9e15 });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Your session has ended. Sign in again." }), {
        status: 401,
      }),
    );
    await expect(refreshSession("admin")).rejects.toThrow("Your session has ended.");
    expect(sessionStore().getSnapshot()).toBeNull();
  });
});
