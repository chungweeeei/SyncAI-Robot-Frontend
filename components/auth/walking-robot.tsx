"use client";

import * as React from "react";
import * as THREE from "three";
import { useTheme } from "next-themes";

import { drawnGround } from "@/lib/map/floors";
import { G23_JOINTS } from "@/lib/robot/g23-joints";
import { createDemoSite } from "@/lib/scene/demo-site";
import { createPathRibbon, type PathRibbon } from "@/lib/scene/path-ribbon";
import { loadRobotModel } from "@/lib/scene/robot-model";
import { THEMES } from "@/lib/scene/theme";
import { createViewport } from "@/lib/scene/viewport";
import { chaseCamera, loopPose, routeAhead } from "@/lib/scene/walk-loop";

/** A frame every ~33 ms: the walk reads as smooth, and a software GPU keeps up. */
const FRAME_S = 1 / 30;
/** How often the route ahead is redrawn, seconds: it moves with the robot. */
const ROUTE_EVERY_S = 0.25;
/**
 * The ground the route band is drawn on: the dashboard's ground floor, which
 * sits under the map frame's 0 (drawnGround). The robot and the grid stand
 * on it too, or the robot floats over its own route.
 */
const GROUND_Z = drawnGround(0);

// The legs' loop. An animation, not a gait: the thigh swings and the knee
// lifts on a sine, diagonal pairs (FL + HR, FR + HL) half a cycle apart, at
// the standing pose's angles on the GLB's axes (G23_JOINTS).
const STEP_S = 0.9;
const STAND_HIP_Y = -0.75;
const STAND_KNEE = 1.5;
const SWING_HIP_Y = 0.22;
const LIFT_KNEE = 0.45;
const LEG_OFFSET: Record<string, number> = { FL: 0, HR: 0, FR: Math.PI, HL: Math.PI };

/** Each joint's angle `t` seconds into the walk; the standing pose when `t` is null. */
function legAngles(t: number | null): Record<string, number> {
  const angles: Record<string, number> = {};
  for (const [leg, offset] of Object.entries(LEG_OFFSET)) {
    const p = t === null ? 0 : (2 * Math.PI * t) / STEP_S + offset;
    const lift = t === null ? 0 : Math.max(0, Math.sin(p));
    const swing = t === null ? 0 : Math.cos(p);
    angles[`${leg}_HipX_joint`] = 0;
    angles[`${leg}_HipY_joint`] = STAND_HIP_Y - SWING_HIP_Y * swing;
    angles[`${leg}_Knee_joint`] = STAND_KNEE + LIFT_KNEE * lift;
  }
  return angles;
}

/** Metre lines on the ground, drawn in the ground's own plane. */
function groundGrid(color: number): THREE.LineSegments {
  const half = 12;
  const step = 1;
  const points: number[] = [];
  // A segment per cell edge, not one per line: a line running from behind
  // the camera to the far end takes its fog from its two ends, and faded out
  // whole.
  for (let v = -half; v <= half + 1e-6; v += step) {
    for (let u = -half; u < half - 1e-6; u += step) {
      points.push(v, u, GROUND_Z, v, u + step, GROUND_Z, u, v, GROUND_Z, u + step, v, GROUND_Z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color }));
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The sign-in screen's picture: the robot walking its route round a shelf
 * in a made-up corner of a warehouse, the camera following from outside
 * its route. The same model and the same route band as the dashboard, so
 * the first thing an operator sees is the machine doing what the console is
 * for. Decoration: hidden from assistive tech, and nothing at all where
 * WebGL is not to be had, rather than an error.
 *
 * Still under reduced motion: one frame of the robot standing on its route.
 * Paused while the tab is hidden, since a sign-in page left open in a
 * background tab would otherwise draw a robot no one sees all day.
 */
export function WalkingRobot({ className }: { className?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || !webglAvailable()) return;
    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const view = createViewport(container, { background: theme.background, near: 0.05 });
    const { scene, camera, renderer, controls } = view;
    controls.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // The floor fades into the background with distance rather than ending.
    scene.fog = new THREE.Fog(theme.background, 6, 14);

    // The dashboard's lighting: a hemisphere fill and a key light on the camera.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(-1, 1, 0);
    keyLight.target.position.set(0, 0, -1);
    camera.add(keyLight, keyLight.target);
    scene.add(camera);

    scene.add(groundGrid(theme.groundGrid));

    scene.add(createDemoSite(theme, GROUND_Z));

    let route: PathRibbon | null = null;
    let routeAge = Infinity;
    const drawRoute = () => {
      if (route) {
        scene.remove(route.mesh);
        route.dispose();
      }
      route = createPathRibbon(routeAhead(t), theme);
      if (route) scene.add(route.mesh);
      routeAge = 0;
    };

    const robotGroup = new THREE.Group();
    scene.add(robotGroup);
    let model: THREE.Object3D | null = null;
    let joints: { node: THREE.Object3D; axis: THREE.Vector3; name: string }[] = [];
    /** base_link's height over the feet at the standing pose. */
    let standHeight = 0;
    let cancelled = false;

    const pose = (angles: Record<string, number>) => {
      for (const joint of joints) {
        const q = angles[joint.name];
        if (q !== undefined) joint.node.quaternion.setFromAxisAngle(joint.axis, q);
      }
    };

    let t = 0;
    let since = 0;
    const place = () => {
      const at = loopPose(t);
      pose(legAngles(reduced ? null : t));
      robotGroup.position.set(at.x, at.y, GROUND_Z + standHeight);
      if (routeAge >= ROUTE_EVERY_S) drawRoute();
      robotGroup.rotation.z = at.yaw;
      // Outside the oval, looking in: the shelf it circles is always behind it.
      const { position, target } = chaseCamera(t);
      camera.position.set(position[0], position[1], GROUND_Z + position[2]);
      camera.lookAt(target[0], target[1], GROUND_Z + target[2]);
    };

    const draw = () => renderer.render(scene, camera);

    loadRobotModel()
      .then((shared) => {
        if (cancelled) return;
        // A clone, sharing the geometry: its joints are this view's alone, and
        // the shared model stays whole for the dashboard after sign-in.
        model = shared.clone();
        joints = [...G23_JOINTS].flatMap(([name, spec]) => {
          const node = model!.getObjectByName(spec.childLink);
          return node ? [{ node, axis: spec.axis, name }] : [];
        });
        pose(legAngles(null));
        model.updateMatrixWorld(true);
        standHeight = -new THREE.Box3().setFromObject(model).min.z;
        robotGroup.add(model);
        place();
        draw();
      })
      .catch(() => {
        // The robot is decoration; the sign-in works without it.
      });

    place();
    view.start({
      draw,
      // A short band (a phone's) narrows the view, or the robot is a speck.
      onResize: (_width, height) => {
        camera.fov = height < 320 ? 26 : 48;
        camera.updateProjectionMatrix();
      },
      frame: (dt) => {
        if (reduced || !model || document.hidden) return;
        since += dt;
        if (since < FRAME_S) return;
        // A long gap (a hidden tab come back) resumes the walk, not a jump.
        const step = Math.min(since, 0.1);
        t += step;
        routeAge += step;
        since = 0;
        place();
        draw();
      },
    });

    return () => {
      cancelled = true;
      // The clone shares the cached model's geometry and material: take it
      // out before the sweep disposes everything left in the scene.
      if (model) robotGroup.remove(model);
      route?.dispose();
      view.dispose();
    };
  }, [resolvedTheme]);

  return <div ref={containerRef} aria-hidden className={className} />;
}
