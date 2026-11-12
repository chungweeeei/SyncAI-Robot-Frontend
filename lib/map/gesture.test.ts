import { describe, expect, it } from "vitest";

import {
  DRAG_DEADZONE_PX,
  PLACE_IDLE,
  headingDegrees,
  isDrag,
  placeGesture,
  type PlaceEvent,
} from "@/lib/map/gesture";

/**
 * The rules a press on a canvas has to keep. Each is something an operator
 * feels: a tap that turns into a drag, a click that snaps a waypoint's
 * heading to 0°.
 */

describe("isDrag", () => {
  it("is a click inside the deadzone and a drag at its edge", () => {
    expect(isDrag(0, 0, DRAG_DEADZONE_PX - 1, 0)).toBe(false);
    expect(isDrag(0, 0, DRAG_DEADZONE_PX, 0)).toBe(true);
  });

  it("measures the straight-line distance, not each axis", () => {
    // 7 px on each axis is under 10 px either way but ~9.9 px across.
    expect(isDrag(0, 0, 7, 7)).toBe(false);
    expect(isDrag(0, 0, 8, 8)).toBe(true);
  });
});

describe("headingDegrees", () => {
  it("reads the map frame: +x is 0°, +y is 90°, counter-clockwise positive", () => {
    expect(headingDegrees(1, 0)).toBe(0);
    expect(headingDegrees(0, 1)).toBe(90);
    expect(headingDegrees(-1, 0)).toBe(180);
    expect(headingDegrees(0, -1)).toBe(-90);
  });

  it("has no answer for no displacement, rather than claiming 0°", () => {
    expect(headingDegrees(0, 0)).toBeNull();
  });
});

/**
 * The placing gesture, as the dashboard and the map editor both run it.
 * What it guards is the robot: nothing but the deliberate lift of the
 * pointer that planted a pose may hand one up.
 */
describe("placeGesture", () => {
  const at = (wx: number, wy: number) => () => ({ wx, wy });
  const nowhere = () => null;
  const press = (over: Partial<Extract<PlaceEvent, { type: "press" }>> = {}): PlaceEvent => ({
    type: "press",
    pointerId: 1,
    primary: true,
    cx: 100,
    cy: 100,
    cast: at(2, 3),
    seedTheta: 45,
    ...over,
  });
  const move = (over: Partial<Extract<PlaceEvent, { type: "move" }>> = {}): PlaceEvent => ({
    type: "move",
    pointerId: 1,
    primary: true,
    cx: 100,
    cy: 100,
    cast: at(2, 3),
    seedTheta: 45,
    carries: true,
    ...over,
  });
  const planted = () => placeGesture(PLACE_IDLE, press()).state;

  it("carries the pose under the bare pointer, and drops it off the map", () => {
    const carried = placeGesture(PLACE_IDLE, move({ cast: at(5, 6) })).state;
    expect(carried).toEqual({ anchor: null, draft: { x: 5, y: 6, theta: 45 }, carrying: true });
    expect(placeGesture(carried, move({ cast: nowhere })).state.draft).toBeNull();
  });

  it("carries nothing where a trailing pose would read as one already set", () => {
    expect(placeGesture(PLACE_IDLE, move({ carries: false })).state).toBe(PLACE_IDLE);
  });

  it("plants on a press and keeps the carried heading rather than snapping to the seed", () => {
    const carried = placeGesture(PLACE_IDLE, move({ seedTheta: 120 })).state;
    const { state } = placeGesture(carried, press({ seedTheta: 0 }));
    expect(state.anchor).toMatchObject({ pointerId: 1, wx: 2, wy: 3 });
    expect(state.draft).toEqual({ x: 2, y: 3, theta: 120 });
    expect(state.carrying).toBe(false);
  });

  it("does not plant off the map", () => {
    expect(placeGesture(PLACE_IDLE, press({ cast: nowhere })).state).toBe(PLACE_IDLE);
  });

  it("only aims once planted, and only past the deadzone", () => {
    const inside = placeGesture(
      planted(),
      move({ cx: 100 + DRAG_DEADZONE_PX - 1, cast: at(9, 9) }),
    ).state;
    expect(inside.draft).toEqual({ x: 2, y: 3, theta: 45 });
    // Straight up the map from where it stands: 90°, and it has not moved.
    const aimed = placeGesture(planted(), move({ cx: 100 + DRAG_DEADZONE_PX, cast: at(2, 8) })).state;
    expect(aimed.draft).toEqual({ x: 2, y: 3, theta: 90 });
  });

  it("aims by the looser cast when one is given, so a heading may point off the map", () => {
    const aimed = placeGesture(
      planted(),
      move({ cx: 200, cast: nowhere, aim: at(-5, 3) }),
    ).state;
    expect(aimed.draft?.theta).toBe(180);
  });

  it("commits on the lift of the pointer that planted it, and of no other", () => {
    const state = planted();
    expect(placeGesture(state, { type: "release", pointerId: 2 })).toEqual({ state, commit: null });
    expect(placeGesture(state, { type: "release", pointerId: 1 })).toEqual({
      state: PLACE_IDLE,
      commit: { x: 2, y: 3, theta: 45 },
    });
  });

  it("is not moved by another pointer once planted", () => {
    const state = planted();
    expect(placeGesture(state, move({ pointerId: 2, cx: 300, cast: at(9, 9) })).state).toBe(state);
    expect(placeGesture(state, move({ primary: false, cx: 300 })).state).toBe(state);
  });

  it("abandons on a second press, so a pinch never sends the robot anywhere", () => {
    const second = placeGesture(planted(), press({ pointerId: 2, primary: false }));
    expect(second).toEqual({ state: PLACE_IDLE, commit: null });
    // And the first finger's lift then commits nothing.
    expect(placeGesture(second.state, { type: "release", pointerId: 1 }).commit).toBeNull();
  });

  it("never commits on a cancel", () => {
    expect(placeGesture(planted(), { type: "abandon" })).toEqual({ state: PLACE_IDLE, commit: null });
  });

  it("drops a carried pose when the pointer leaves, and keeps a planted one", () => {
    const carried = placeGesture(PLACE_IDLE, move()).state;
    expect(placeGesture(carried, { type: "leave" }).state).toBe(PLACE_IDLE);
    const state = planted();
    expect(placeGesture(state, { type: "leave" }).state).toBe(state);
  });
});
