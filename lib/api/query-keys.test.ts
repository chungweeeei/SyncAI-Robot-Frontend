import { describe, expect, it } from "vitest";

import { mapScopedKeys, queryKeys } from "@/lib/api/query-keys";

describe("mapScopedKeys", () => {
  it("names every key that is keyed by a map, so a rename or delete drops it", () => {
    // A `map-…` key built from a name is one map's; `maps` is the catalogue.
    const builders: unknown[] = Object.values(queryKeys);
    const perMap = builders
      .filter((key) => typeof key === "function")
      .map((build) => (build as (name: string) => readonly unknown[])("probe"))
      .filter((key) => String(key[0]).startsWith("map-") && key[1] === "probe")
      .map((key) => key[0]);

    expect(perMap.length).toBeGreaterThan(0);
    expect(mapScopedKeys("probe").map((key) => key[0]).sort()).toEqual([...perMap].sort());
  });

  it("drops by the name-only prefix, so every version of a file goes", () => {
    for (const key of mapScopedKeys("probe")) expect(key).toEqual([key[0], "probe"]);
  });
});
