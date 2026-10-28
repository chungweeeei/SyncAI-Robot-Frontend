import { describe, expect, it } from "vitest";

import { planCaptions } from "@/lib/map/preview";

/**
 * The rule the route map's captions keep: captions that would smear give way
 * in a known order, the job's stops first.
 */

describe("planCaptions", () => {
  // Seven px a character, like a monospace caption at 11 px.
  const measure = (text: string) => text.length * 7;
  const at = (id: string, cx: number, cy: number) => ({ id, cx, cy, caption: `G · ${id}` });

  it("keeps every caption when none touch", () => {
    const kept = planCaptions([at("a", 10, 10), at("b", 10, 60), at("c", 120, 10)], measure);
    expect([...kept]).toEqual(["a", "b", "c"]);
  });

  it("drops a caption that would sit on one already placed, in priority order", () => {
    // Two stops three pixels apart: the first in the list is the lit one and
    // keeps its name; the second falls back to its glyph rather than smear it.
    const kept = planCaptions([at("lit", 10, 10), at("near", 13, 12)], measure);
    expect(kept.has("lit")).toBe(true);
    expect(kept.has("near")).toBe(false);
  });

  it("lets a third stop keep its name once the collision is out of its way", () => {
    // `near` lost its caption, so it takes no room: `next` only has to clear
    // `lit`, and it does.
    const kept = planCaptions(
      [at("lit", 10, 10), at("near", 13, 12), at("next", 10, 30)],
      measure,
    );
    expect([...kept]).toEqual(["lit", "next"]);
  });
});
