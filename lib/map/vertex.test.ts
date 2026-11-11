import { describe, expect, it } from "vitest";

import { VERTEX_TYPES, hasChargerMark, vertexGlyph } from "@/lib/map/vertex";

describe("a waypoint's type mark", () => {
  it("marks a charger with the bolt and every other type with its own glyph", () => {
    for (const spec of VERTEX_TYPES) {
      expect(hasChargerMark(spec.value)).toBe(spec.value === "CHARGE");
    }
    // No two types share a glyph, or a list would read them as one.
    const glyphs = VERTEX_TYPES.map((spec) => vertexGlyph(spec.value));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
