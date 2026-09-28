import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";

import { MIN_DOLLY_M, dollyStep, frameMap } from "@/lib/scene/camera";

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
    // Recenter's promise is the opening view back, whatever the operator did in
    // between; a second call from an orbited camera must land where the first
    // did.
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
    // Past the target the view flips, and a button that can flip the view on
    // the tenth press is a button nobody presses ten times.
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
