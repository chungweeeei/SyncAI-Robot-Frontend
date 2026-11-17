import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { login } from "@/lib/api/auth";

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
    expect(session).toEqual({ token: "tok", username: "admin", expiresAt: 5_000_000 + 3_600_000 });
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
