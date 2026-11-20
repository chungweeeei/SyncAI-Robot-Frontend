import { describe, expect, it } from "vitest";

import { loginHref, safeNextPath } from "@/lib/auth/next-path";

describe("safeNextPath", () => {
  it("keeps a path on this console, query and all", () => {
    expect(safeNextPath("/maps/lab/edit?tool=waypoint")).toBe("/maps/lab/edit?tool=waypoint");
  });

  it("never leaves the console, since a sign-in that redirects off-site is a phishing link", () => {
    for (const raw of ["https://evil.example", "//evil.example", "/\\evil.example", "evil"]) {
      expect(safeNextPath(raw)).toBe("/");
    }
  });

  it("does not send a sign-in back to the sign-in", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/login?next=%2Fmaps")).toBe("/");
  });

  it("falls back to the dashboard with nothing to go back to", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});

describe("loginHref", () => {
  it("carries the screen to come back to", () => {
    expect(loginHref("/tasks?map=lab")).toBe("/login?next=%2Ftasks%3Fmap%3Dlab");
  });

  it("is bare for the dashboard, where a sign-in lands anyway", () => {
    expect(loginHref("/")).toBe("/login");
  });
});
