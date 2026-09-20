import { describe, expect, it } from "vitest";

import type { GridSize } from "@/lib/map/grid";
import {
  MAX_SCALE,
  cellAt,
  centerView,
  fitScale,
  fitView,
  gridToScreen,
  gridToWorld,
  panBy,
  screenToGrid,
  worldToGrid,
  zoomAt,
  type View,
} from "@/lib/map/view";
import type { MapMetadata } from "@/lib/types/robot";

/** A map with a non-zero origin and a non-unit resolution, so a dropped term shows. */
const meta: MapMetadata = {
  resolution: 0.05,
  origin: [-12.3, -7.8, 0],
  width: 400,
  height: 300,
};
const size: GridSize = { width: meta.width, height: meta.height };
const rect = { width: 800, height: 600 };

describe("worldToGrid / gridToWorld", () => {
  it("round-trips a pose through the grid and back", () => {
    for (const [wx, wy] of [
      [0, 0],
      [-12.3, -7.8],
      [3.25, -1.05],
      [5, 6.5],
    ]) {
      const { px, py } = worldToGrid(wx, wy, meta);
      const back = gridToWorld(px, py, meta);
      expect(back.wx).toBeCloseTo(wx, 9);
      expect(back.wy).toBeCloseTo(wy, 9);
    }
  });

  it("puts the map origin at the grid's bottom-left, not its top-left", () => {
    // The y flip is the one that is silently wrong if dropped: canvas rows grow
    // downward while the ROS grid's row 0 is at the origin, so a mirrored map
    // still looks like a map.
    const atOrigin = worldToGrid(meta.origin[0], meta.origin[1], meta);
    expect(atOrigin.px).toBeCloseTo(0, 9);
    expect(atOrigin.py).toBeCloseTo(meta.height, 9);
  });

  it("moves down the grid as world y increases", () => {
    const low = worldToGrid(0, 0, meta);
    const high = worldToGrid(0, 1, meta);
    expect(high.py).toBeLessThan(low.py);
  });
});

describe("screenToGrid / gridToScreen", () => {
  const view: View = { scale: 3.5, ox: -120, oy: 40 };

  it("round-trips a container-local point", () => {
    for (const [cx, cy] of [
      [0, 0],
      [17, 233],
      [799.5, 599.5],
    ]) {
      const { px, py } = screenToGrid(view, cx, cy);
      const back = gridToScreen(view, px, py);
      expect(back.cx).toBeCloseTo(cx, 9);
      expect(back.cy).toBeCloseTo(cy, 9);
    }
  });
});

describe("fitView", () => {
  it("scales by the tighter axis and centres the slack on the other", () => {
    const view = fitView(rect, size);
    expect(view.scale).toBeCloseTo(fitScale(rect, size), 12);
    // 800/400 = 2 and 600/300 = 2 here, so it fits exactly with no slack.
    expect(view.ox).toBeCloseTo(0, 9);
    expect(view.oy).toBeCloseTo(0, 9);
  });

  it("centres the slack when the aspects differ", () => {
    const wide = { width: 1200, height: 600 };
    const view = fitView(wide, size);
    expect(view.scale).toBeCloseTo(2, 9);
    expect(view.ox).toBeCloseTo((1200 - 400 * 2) / 2, 9);
    expect(view.oy).toBeCloseTo(0, 9);
  });

  it("puts the whole grid on screen", () => {
    const wide = { width: 1200, height: 600 };
    const view = fitView(wide, size);
    const topLeft = gridToScreen(view, 0, 0);
    const bottomRight = gridToScreen(view, size.width, size.height);
    expect(topLeft.cx).toBeGreaterThanOrEqual(-1e-9);
    expect(topLeft.cy).toBeGreaterThanOrEqual(-1e-9);
    expect(bottomRight.cx).toBeLessThanOrEqual(wide.width + 1e-9);
    expect(bottomRight.cy).toBeLessThanOrEqual(wide.height + 1e-9);
  });
});

describe("cellAt", () => {
  const view = fitView(rect, size);

  it("floors to the cell under the point", () => {
    expect(cellAt(view, size, 0, 0)).toEqual({ col: 0, row: 0 });
    expect(cellAt(view, size, 5, 5)).toEqual({ col: 2, row: 2 });
  });

  it("answers null outside the grid rather than clamping", () => {
    expect(cellAt(view, size, -1, 10)).toBeNull();
    expect(cellAt(view, size, 10, -1)).toBeNull();
    expect(cellAt(view, size, rect.width + 1, 10)).toBeNull();
    expect(cellAt(view, size, 10, rect.height + 1)).toBeNull();
  });
});

describe("zoomAt", () => {
  const start = fitView(rect, size);

  it("holds the grid point under the cursor still", () => {
    // The property that makes wheel zoom feel anchored rather than springy.
    const cx = 210;
    const cy = 375;
    const before = screenToGrid(start, cx, cy);
    const zoomed = zoomAt(start, cx, cy, 2, rect, size);
    const after = screenToGrid(zoomed, cx, cy);
    expect(after.px).toBeCloseTo(before.px, 6);
    expect(after.py).toBeCloseTo(before.py, 6);
  });

  it("never zooms out past fit or in past MAX_SCALE", () => {
    const min = fitScale(rect, size);
    expect(zoomAt(start, 400, 300, 0.01, rect, size).scale).toBeCloseTo(min, 9);
    let view = start;
    for (let i = 0; i < 40; i += 1) view = zoomAt(view, 400, 300, 2, rect, size);
    expect(view.scale).toBe(MAX_SCALE);
  });
});

describe("panBy", () => {
  it("cannot drag the map entirely off screen", () => {
    // The straddle rule: the far edge may not come short of the viewport
    // midpoint, so there is always something to grab and drag back.
    const zoomed = zoomAt(fitView(rect, size), 400, 300, 4, rect, size);
    const flung = panBy(zoomed, 1e6, 1e6, rect, size);
    expect(flung.ox).toBeLessThanOrEqual(rect.width / 2 + 1e-9);
    expect(flung.oy).toBeLessThanOrEqual(rect.height / 2 + 1e-9);

    const other = panBy(zoomed, -1e6, -1e6, rect, size);
    expect(other.ox + size.width * other.scale).toBeGreaterThanOrEqual(
      rect.width / 2 - 1e-9,
    );
    expect(other.oy + size.height * other.scale).toBeGreaterThanOrEqual(
      rect.height / 2 - 1e-9,
    );
  });

  it("leaves the zoom alone", () => {
    const zoomed = zoomAt(fitView(rect, size), 400, 300, 4, rect, size);
    expect(panBy(zoomed, 30, -70, rect, size).scale).toBe(zoomed.scale);
  });
});

describe("centerView", () => {
  it("brings a point inside the map exactly to the viewport centre", () => {
    const zoomed = zoomAt(fitView(rect, size), 400, 300, 6, rect, size);
    const centred = centerView(zoomed, 123, 210, rect, size);
    const where = gridToScreen(centred, 123, 210);
    expect(where.cx).toBeCloseTo(rect.width / 2, 6);
    expect(where.cy).toBeCloseTo(rect.height / 2, 6);
  });

  it("keeps the zoom the operator set", () => {
    const zoomed = zoomAt(fitView(rect, size), 400, 300, 6, rect, size);
    expect(centerView(zoomed, 10, 10, rect, size).scale).toBe(zoomed.scale);
  });
});
