import { describe, expect, it } from "vitest";

import {
  canCloseZoneSession,
  initialZoneSession,
  zoneSessionDirty,
  zoneSessionReducer,
  type ZoneSession,
  type ZoneSessionAction,
} from "@/lib/map/zone-session";
import type { ZonePolygon } from "@/lib/map/zone";

/**
 * The rules the map editor keeps for forbidden zones. Each is something the
 * operator would otherwise feel: a zone erased by a save over a list never
 * read, a shape left joined to a zone that is gone, an Undo that skips a
 * zone edit or takes a whole corner drag back one move at a time.
 */

const square = (id: string, at = 0): ZonePolygon => ({
  id,
  points: [
    { x: at, y: 0 },
    { x: at + 1, y: 0 },
    { x: at + 1, y: 1 },
    { x: at, y: 1 },
  ],
});

const run = (state: ZoneSession, ...actions: ZoneSessionAction[]) =>
  actions.reduce(zoneSessionReducer, state);

describe("zoneSessionReducer", () => {
  it("takes the robot's list once, and never over edits already made", () => {
    const unread = initialZoneSession(null);
    expect(zoneSessionDirty(unread)).toBe(false);

    const loaded = run(unread, { type: "load", zones: [square("z1")] });
    const edited = run(loaded, { type: "remove", ids: ["z1"] });
    // A second read (a refetch) must not put back what the operator removed.
    const reread = run(edited, { type: "load", zones: [square("z1")] });
    expect(reread.zones).toEqual([]);
  });

  it("refuses every edit to finished zones while the list is unread", () => {
    const unread = initialZoneSession(null);
    const tried = run(
      unread,
      { type: "add", point: { x: 0, y: 0 } },
      { type: "add", point: { x: 1, y: 0 } },
      { type: "add", point: { x: 1, y: 1 } },
      { type: "close" },
    );
    // A save is the whole list; a zone added over "unknown" would erase the rest.
    expect(tried.zones).toBeNull();
    expect(canCloseZoneSession(tried)).toBe(false);
  });

  it("closes a shape of three corners into a new zone, banded when asked", () => {
    const state = run(
      initialZoneSession([square("z1")]),
      { type: "add", point: { x: 5, y: 5 } },
      { type: "add", point: { x: 6, y: 5 } },
    );
    expect(canCloseZoneSession(state)).toBe(false);

    const closed = run(
      state,
      { type: "add", point: { x: 6, y: 6 } },
      { type: "close", band: { z_min: 2, z_max: 3 } },
    );
    expect(closed.draft).toEqual([]);
    expect(closed.zones).toHaveLength(2);
    expect(closed.zones?.[1]).toMatchObject({ z_min: 2, z_max: 3 });
    expect(zoneSessionDirty(closed)).toBe(true);
  });

  it("joins a shape to a zone's corner and merges it under that zone's id", () => {
    const anchored = run(initialZoneSession([square("z1")]), {
      type: "anchor",
      zoneId: "z1",
      index: 1,
    });
    expect(anchored.anchor).toEqual({ zoneId: "z1", index: 1, position: 0 });
    // An anchored shape ends on its zone, never closes on its own.
    expect(canCloseZoneSession(run(anchored, { type: "add", point: { x: 3, y: 0 } }, { type: "add", point: { x: 3, y: 1 } }))).toBe(false);

    const merged = run(
      anchored,
      { type: "add", point: { x: 3, y: 0.5 } },
      { type: "merge", target: 2 },
    );
    expect(merged.anchor).toBeNull();
    expect(merged.draft).toEqual([]);
    expect(merged.zones).toHaveLength(1);
    expect(merged.zones?.[0].id).toBe("z1");
    expect(merged.zones?.[0].points).toContainEqual({ x: 3, y: 0.5 });
  });

  it("lets go of the zone when the anchor's own corner is taken back", () => {
    const state = run(
      initialZoneSession([square("z1")]),
      { type: "add", point: { x: 5, y: 5 } },
      { type: "anchor", zoneId: "z1", index: 0 },
    );
    expect(state.anchor?.position).toBe(1);
    const popped = run(state, { type: "pop" });
    expect(popped.anchor).toBeNull();
    expect(popped.draft).toEqual([{ x: 5, y: 5 }]);
  });

  it("drops a shape anchored on a zone that is removed", () => {
    const state = run(
      initialZoneSession([square("z1"), square("z2", 5)]),
      { type: "anchor", zoneId: "z1", index: 0 },
      { type: "remove", ids: ["z1"] },
    );
    expect(state.anchor).toBeNull();
    expect(state.draft).toEqual([]);
    expect(state.zones?.map((zone) => zone.id)).toEqual(["z2"]);
  });

  it("ignores a drag of a corner a Remove already took away", () => {
    const state = initialZoneSession([square("z1")]);
    const moved = run(state, { type: "move", corner: { zoneId: "z1", index: 9 }, point: { x: 9, y: 9 } });
    expect(moved.zones?.[0].points).toHaveLength(4);
  });

  it("measures dirty against what the last save sent, not what is on screen now", () => {
    const sent = [square("z1"), square("z2", 5)];
    // A zone drawn since the last read: the screen holds two, the saved list one.
    const onScreen = { ...initialZoneSession([square("z1")]), zones: sent };
    const saved = run(onScreen, { type: "saved", zones: sent });
    expect(zoneSessionDirty(saved)).toBe(false);

    // A corner dragged while the save was in flight stays unsaved after it.
    const dragged = run(onScreen, {
      type: "move",
      corner: { zoneId: "z2", index: 0 },
      point: { x: 4, y: 0 },
    });
    expect(zoneSessionDirty(run(dragged, { type: "saved", zones: sent }))).toBe(true);
  });

  it("records each finished edit for Undo, and nothing for one that changed nothing", () => {
    const start = initialZoneSession([square("z1"), square("z2", 5)]);
    const removed = run(start, { type: "remove", ids: ["z1"] });
    expect(removed.commit).toEqual({ before: start.zones, after: [square("z2", 5)] });

    // A remove that hits nothing and a close short of corners are not edits.
    expect(run(removed, { type: "remove", ids: ["gone"] }).commit).toBe(removed.commit);
    const short = run(removed, { type: "add", point: { x: 9, y: 9 } }, { type: "close" });
    expect(short.commit).toBe(removed.commit);

    // A shape in flight is not one either: it has its own Backspace.
    expect(run(start, { type: "add", point: { x: 9, y: 9 } }).commit).toBeNull();
  });

  it("records a corner drag as one edit, once it is let go", () => {
    const start = initialZoneSession([square("z1")]);
    const corner = { zoneId: "z1", index: 0 };
    const dragging = run(
      start,
      { type: "move", corner, point: { x: -1, y: 0 } },
      { type: "move", corner, point: { x: -2, y: 0 } },
      { type: "move", corner, point: { x: -3, y: 0 } },
    );
    expect(dragging.commit).toBeNull();

    const dropped = run(dragging, { type: "dragEnd" });
    expect(dropped.commit?.before).toEqual(start.zones);
    expect(dropped.commit?.after[0].points[0]).toEqual({ x: -3, y: 0 });
    expect(dropped.dragFrom).toBeNull();

    // A drag that ends where it began records nothing.
    const back = run(
      start,
      { type: "move", corner, point: { x: -1, y: 0 } },
      { type: "move", corner, point: { x: 0, y: 0 } },
      { type: "dragEnd" },
    );
    expect(back.commit).toBeNull();
  });

  it("steps back to a saved list on Undo, measuring dirty against what was saved", () => {
    const zones = [square("z1"), square("z2", 5)];
    const removed = run(initialZoneSession(zones), { type: "remove", ids: ["z1"] });
    expect(zoneSessionDirty(removed)).toBe(true);
    const undone = run(removed, { type: "replace", zones: removed.commit!.before });
    expect(undone.zones).toEqual(zones);
    expect(zoneSessionDirty(undone)).toBe(false);

    // After a save the same Undo is an unsaved edit again.
    const saved = run(removed, { type: "saved", zones: removed.zones! });
    expect(zoneSessionDirty(run(saved, { type: "replace", zones }))).toBe(true);
  });

  it("drops a shape in flight on Undo, since its anchor may be the zone undone", () => {
    const state = run(
      initialZoneSession([square("z1")]),
      { type: "anchor", zoneId: "z1", index: 0 },
      { type: "add", point: { x: 3, y: 3 } },
      { type: "replace", zones: [] },
    );
    expect(state.draft).toEqual([]);
    expect(state.anchor).toBeNull();
  });
});
