import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";

import {
  MIN_DOLLY_M,
  applyMap3dControls,
  frameGround,
  dollyStep,
  frameMap,
  frontView,
  frontViewAround,
  overheadDistance,
} from "@/lib/scene/camera";

function rig() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, document.createElement("div"));
  return { camera, controls };
}

describe("frameMap", () => {
  it("aims at the map's centre from south of it and above", () => {
    const { camera, controls } = rig();
    frameMap(camera, controls, { cx: 4, cy: -2, widthM: 30, heightM: 10 });

    expect(controls.target.toArray()).toEqual([4, -2, 0]);
    // The longer side sets the distance, so a wide map is not framed by its
    // short axis and cropped at both ends.
    expect(camera.position.x).toBe(4);
    expect(camera.position.y).toBeLessThan(-2);
    expect(camera.position.z).toBeCloseTo(30 * 0.8);
  });

  it("is the same view every time it is asked for", () => {
    // Recenter from an orbited camera must land on the opening view.
    const frame = { cx: 0, cy: 0, widthM: 20, heightM: 20 };
    const { camera, controls } = rig();
    frameMap(camera, controls, frame);
    const opening = camera.position.clone();

    camera.position.set(50, 40, 3);
    controls.target.set(9, 9, 0);
    frameMap(camera, controls, frame);

    expect(camera.position.toArray()).toEqual(opening.toArray());
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
  });
});

describe("dollyStep", () => {
  it("divides the distance to the target by the factor and leaves the target alone", () => {
    const { camera, controls } = rig();
    controls.target.set(1, 2, 0);
    camera.position.set(1, 2 - 6, 8);

    dollyStep(camera, controls, 2);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(5);
    expect(controls.target.toArray()).toEqual([1, 2, 0]);
    // Along the same line: zooming must not swing the view.
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.y).toBeCloseTo(2 - 3);
    expect(camera.position.z).toBeCloseTo(4);
  });

  it("backs off with a factor below one", () => {
    const { camera, controls } = rig();
    camera.position.set(0, -3, 4);

    dollyStep(camera, controls, 1 / 2);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(10);
  });

  it("never crosses the target, however often it is pressed", () => {
    // Past the target the view would flip.
    const { camera, controls } = rig();
    camera.position.set(0, -3, 4);
    const before = camera.position.clone().normalize();

    for (let i = 0; i < 20; i++) dollyStep(camera, controls, Math.SQRT2);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(MIN_DOLLY_M);
    expect(camera.position.clone().normalize().toArray()).toEqual(
      before.toArray().map((v) => expect.closeTo(v, 6)),
    );
  });

  it("leaves a camera that sits on its target where it is", () => {
    const { camera, controls } = rig();
    camera.position.set(0, 0, 0);

    dollyStep(camera, controls, 2);

    expect(camera.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe("frontView", () => {
  const frame = { cx: 10, cy: 4, widthM: 30, heightM: 20 };
  const z = { lo: -0.5, hi: 6 };

  it("looks level along +y from south of the map, at the middle of the heights", () => {
    const { camera, controls } = rig();
    frontView(camera, controls, frame, z);
    expect(controls.target.distanceTo(new THREE.Vector3(10, 4, 2.75))).toBeCloseTo(0);
    expect(camera.position.x).toBeCloseTo(10);
    expect(camera.position.z).toBeCloseTo(2.75);
    // South of the near edge, never inside the box.
    expect(camera.position.y).toBeLessThan(frame.cy - frame.heightM / 2);
  });

  it("stands back far enough to fit the width and the heights", () => {
    const { camera, controls } = rig();
    frontView(camera, controls, frame, z);
    const fromNearEdge = frame.cy - frame.heightM / 2 - camera.position.y;
    expect(fromNearEdge).toBeCloseTo(overheadDistance(camera, 30, 6.5));
  });
});

describe("frontViewAround", () => {
  it("swings level and due south of a pinned target, keeping the zoom", () => {
    const { camera, controls } = rig();
    controls.target.set(1, 2, 0.5);
    camera.position.set(4, 6, 12.5);
    const before = camera.position.distanceTo(controls.target);
    frontViewAround(camera, controls);
    expect(controls.target.distanceTo(new THREE.Vector3(1, 2, 0.5))).toBeCloseTo(0);
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.z).toBeCloseTo(0.5);
    expect(camera.position.y).toBeCloseTo(2 - before);
  });
});

describe("the 3D view's controls", () => {
  it("gives the primary button and one finger to Waypoint only while it is armed", () => {
    const { controls } = rig();
    applyMap3dControls(controls, false);
    expect(controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(controls.touches.ONE).toBe(THREE.TOUCH.ROTATE);
    applyMap3dControls(controls, true);
    expect(controls.mouseButtons.LEFT).toBeNull();
    expect(controls.touches.ONE).toBeNull();
    // Still a way to look around while placing, and a pinch still zooms.
    expect(controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    expect(controls.touches.TWO).toBe(THREE.TOUCH.DOLLY_PAN);
  });

  it("opens on the floor shown, so the middle of the screen is the map's", () => {
    const { camera, controls } = rig();
    frameGround(camera, controls, { cx: 3, cy: 4, widthM: 10, heightM: 6 }, -0.45);
    expect(controls.target.distanceTo(new THREE.Vector3(3, 4, -0.45))).toBeCloseTo(0);
    expect(camera.position.x).toBeCloseTo(3);
  });
});
