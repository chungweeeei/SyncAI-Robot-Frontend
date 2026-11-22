import { describe, expect, it } from "vitest";

import { MAP_NAME_RE, resumedSaveProblem } from "@/lib/map/name";

describe("resumedSaveProblem", () => {
  it("refuses the name of the map the run continues, since the robot would", () => {
    // Well-formed, so the name rule alone would let it through to a refusal.
    expect(MAP_NAME_RE.test("site_a")).toBe(true);
    expect(resumedSaveProblem("site_a", "site_a")).toMatch(/another name/);
  });

  it("names the map, so the operator knows which one stays as it is", () => {
    expect(resumedSaveProblem("site_a", "site_a")).toContain("site_a");
  });

  it("lets any other name through", () => {
    expect(resumedSaveProblem("site_a_east", "site_a")).toBeNull();
    // Names are case-sensitive on the robot: a different case is another map.
    expect(resumedSaveProblem("Site_A", "site_a")).toBeNull();
    expect(resumedSaveProblem("", "site_a")).toBeNull();
  });

  it("has nothing to say about a run started from nothing", () => {
    expect(resumedSaveProblem("site_a", null)).toBeNull();
  });
});
