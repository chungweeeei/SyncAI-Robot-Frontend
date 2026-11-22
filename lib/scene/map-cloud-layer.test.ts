import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  SAVED_MAP_CELL_M,
  createStreamedMapLayer,
  pointsOffSavedMap,
  savedMapCells,
} from "@/lib/scene/map-cloud-layer";
import { THEMES } from "@/lib/scene/theme";

const cloud = (points: number[][]) => ({
  count: points.length,
  positions: new Float32Array(points.flat()),
});
const frame = cloud([[1, 2, 3]]);

describe("createStreamedMapLayer", () => {
  it.each(["light", "dark"] as const)(
    "draws the saved map and the run in two colours (%s)",
    (name) => {
      const theme = THEMES[name];
      const run = createStreamedMapLayer(frame, "run", theme);
      const saved = createStreamedMapLayer(frame, "saved", theme);
      const colour = (p: THREE.Points) => (p.material as THREE.PointsMaterial).color;
      // Apart in hue, not just a step in lightness: two greys read as one map.
      const hsl = { h: 0, s: 0, l: 0 };
      expect(colour(saved).getHSL(hsl).s).toBeGreaterThan(0.2);
      expect(colour(saved).getHex()).not.toBe(colour(run).getHex());
    },
  );

  it("never lets the saved map hide a run point beside it", () => {
    const run = createStreamedMapLayer(frame, "run", THEMES.dark);
    const saved = createStreamedMapLayer(frame, "saved", THEMES.dark);
    expect(saved.renderOrder).toBeLessThan(run.renderOrder);
    expect((saved.material as THREE.Material).depthWrite).toBe(false);
  });
});

describe("pointsOffSavedMap", () => {
  const saved = savedMapCells(cloud([[0.1, 0.1, 0.1], [5.1, 0.1, 0.1]]));

  it("drops the run's re-scan of what the saved map already has", () => {
    // A resumed run re-walks much of the map; drawn whole, it buries it.
    const run = cloud([[0.15, 0.12, 0.1], [5.05, 0.1, 0.12]]);
    expect(pointsOffSavedMap(run, saved).count).toBe(0);
  });

  it("keeps what the run added, and a wall a resume put off its saved twin", () => {
    const run = cloud([
      [12, 3, 0.5], // a room the saved map never saw
      [0.1 + 2 * SAVED_MAP_CELL_M, 0.1, 0.1], // the same wall, two cells off
    ]);
    const off = pointsOffSavedMap(run, saved);
    expect(off.count).toBe(2);
    expect(Array.from(off.positions)).toEqual(Array.from(run.positions));
  });

  it("works below the origin, where the map frame goes negative", () => {
    const below = savedMapCells(cloud([[-3.1, -7.9, -0.3]]));
    expect(pointsOffSavedMap(cloud([[-3.05, -7.95, -0.25]]), below).count).toBe(0);
    expect(pointsOffSavedMap(cloud([[3.05, 7.95, 0.25]]), below).count).toBe(1);
  });

  it("leaves the frame it cut untouched, for the next re-apply", () => {
    const run = cloud([[0.1, 0.1, 0.1], [9, 9, 9]]);
    pointsOffSavedMap(run, saved);
    expect(Array.from(run.positions)).toEqual([0.1, 0.1, 0.1, 9, 9, 9].map(Math.fround));
  });
});
