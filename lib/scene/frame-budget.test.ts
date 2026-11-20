import { describe, expect, it } from "vitest";

import { MIN_FPS, createFrameBudget } from "@/lib/scene/frame-budget";

/** Run `seconds` of ticks at `tickHz`, drawing on every `drawEvery`-th tick. */
function run(seconds: number, tickHz: number, drawEvery = 1) {
  const budget = createFrameBudget();
  const verdicts = [];
  for (let i = 0; i < seconds * tickHz; i += 1) {
    verdicts.push(budget.tick(1 / tickHz, i % drawEvery === 0));
  }
  return verdicts;
}

describe("createFrameBudget", () => {
  it("keeps the animation on a machine that draws at its 30 fps", () => {
    expect(run(3, 60, 2).at(-1)).toBe("keep");
  });

  it("stops it on one that draws in software, a handful of frames a second", () => {
    expect(run(3, 8).at(-1)).toBe("stop");
  });

  it("draws the line at MIN_FPS", () => {
    expect(run(3, MIN_FPS + 2).at(-1)).toBe("keep");
    expect(run(3, MIN_FPS - 2).at(-1)).toBe("stop");
  });

  it("says nothing until it has measured, and does not change its mind after", () => {
    const verdicts = run(6, 8);
    expect(verdicts[0]).toBe("measuring");
    const first = verdicts.findIndex((v) => v !== "measuring");
    expect(new Set(verdicts.slice(first))).toEqual(new Set(["stop"]));
  });

  it("starts over after a gap, so a tab hidden mid-measure is not read as slow", () => {
    const budget = createFrameBudget();
    for (let i = 0; i < 40; i += 1) budget.tick(1 / 60, i % 2 === 0);
    expect(budget.tick(30, true)).toBe("measuring");
    let verdict = "measuring";
    for (let i = 0; i < 180; i += 1) verdict = budget.tick(1 / 60, i % 2 === 0);
    expect(verdict).toBe("keep");
  });
});
