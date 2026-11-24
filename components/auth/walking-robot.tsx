"use client";

import * as React from "react";
import * as THREE from "three";
import { useTheme } from "next-themes";

import { drawnGround } from "@/lib/map/floors";
import { useSignInRobotProfile } from "@/hooks/use-sign-in-robot-profile";
import { walkAngles } from "@/lib/robot/walk";
import { easeInOut } from "@/lib/scene/camera";
import { DEMO_PROPS, createDemoSite } from "@/lib/scene/demo-site";
import { createFrameBudget } from "@/lib/scene/frame-budget";
import { SWEEP_TURN_S, createLidarLayer, sweepFan } from "@/lib/scene/lidar-sweep";
import { createPathRibbon, type PathRibbon } from "@/lib/scene/path-ribbon";
import { loadRobotModel } from "@/lib/scene/robot-model";
import { THEMES } from "@/lib/scene/theme";
import { createViewport } from "@/lib/scene/viewport";
import { chaseCamera, loopDistance, loopPose, routeAhead } from "@/lib/scene/walk-loop";

/** A frame every ~33 ms: the walk reads as smooth, and a software GPU keeps up. */
const FRAME_S = 1 / 30;
/** The opening: the camera's way down from over the set onto the robot, seconds. */
const INTRO_S = 2.6;
/** Where the opening starts: high over the set, looking down at all of it. */
const OVERVIEW = { position: [0.5, -8.5, 9.5], target: [0, 0, 0] } as const;
/**
 * Fans of rays laid per drawn frame. One fan a frame at 30 fps is a ray
 * every 14° of the head's turn; four close the gaps to a sweep.
 */
const FANS_PER_FRAME = 4;
/** The lidar's height over the base, metres: on the head, over the body. */
const LIDAR_UP_M = 0.12;
/** How often the route ahead is redrawn, seconds: it moves with the robot. */
const ROUTE_EVERY_S = 0.25;
/**
 * The ground the route band is drawn on: the dashboard's ground floor, which
 * sits under the map frame's 0 (drawnGround). The robot and the grid stand
 * on it too, or the robot floats over its own route.
 */
const GROUND_Z = drawnGround(0);

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
 * (rolling it, for a wheel-legged robot: its profile's walk says which)
 * in a made-up corner of a warehouse, its lidar sweeping the set into
 * fading points coloured as the 3D map is, the camera coming down from over
 * the set and then following from outside its route. The same model and the same route band as the dashboard, so
 * the first thing an operator sees is the machine doing what the console is
 * for. Decoration: hidden from assistive tech, and nothing at all where
 * WebGL is not to be had, rather than an error.
 *
 * Still under reduced motion: one frame of the robot standing on its route,
 * one full turn of its scan laid down at once. Still too on a machine that
 * cannot draw it at MIN_FPS (lib/scene/frame-budget.ts), which settles on
 * that frame rather than hold the main thread the form types on.
 * Paused while the tab is hidden, since a sign-in page left open in a
 * background tab would otherwise draw a robot no one sees all day.
 */
export function WalkingRobot({ className }: { className?: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  // Which robot this is; undefined until the backend has said, and null for a
  // kind this console has no picture of: the set is drawn without one.
  const profile = useSignInRobotProfile();

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

    const lidar = createLidarLayer(GROUND_Z, 9000);
    scene.add(lidar.points);
    /** Where the head is, over the set's ground, `at` seconds in. */
    const lidarOrigin = (at: number): [number, number, number] => {
      const p = loopPose(at);
      return [p.x + Math.cos(p.yaw) * 0.25, p.y + Math.sin(p.yaw) * 0.25, standHeight + LIDAR_UP_M];
    };
    /** Lay the fans the head sent between `from` and `to` seconds. */
    const sweep = (from: number, to: number, fans: number) => {
      for (let k = 1; k <= fans; k += 1) {
        const at = from + ((to - from) * k) / fans;
        lidar.add(lidarOrigin(at), sweepFan(at, loopPose(at).yaw), DEMO_PROPS, at);
      }
      lidar.setTime(to);
    };

    let route: PathRibbon | null = null;
    let routeAge = Infinity;
    const drawRoute = () => {
      if (route) {
        scene.remove(route.mesh);
        route.dispose();
      }
      route = createPathRibbon(routeAhead(t), theme);
      // The scan's points are the 3D map's ramp, blue through cyan, which the
      // route's own cyan sank into: the dashboard's colours for a route over
      // the 3D map, a pale core on a dark rim, for the same reason.
      route?.setOverMap(true);
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
    /** Reduced motion asked for, or this machine could not keep up. */
    let still = reduced;
    const budget = createFrameBudget();
    const place = () => {
      const at = loopPose(t);
      if (profile) {
        pose(walkAngles(profile.walk, still ? null : { t, distanceM: loopDistance(t) }));
      }
      robotGroup.position.set(at.x, at.y, GROUND_Z + standHeight);
      if (routeAge >= ROUTE_EVERY_S) drawRoute();
      robotGroup.rotation.z = at.yaw;
      // Outside the oval, looking in: the shelf it circles is always behind it.
      // Until the opening is over, eased in from high over the whole set.
      const chase = chaseCamera(t);
      const k = still ? 1 : easeInOut(t / INTRO_S);
      const mix = (a: readonly number[], b: readonly number[], i: number) =>
        a[i] + (b[i] - a[i]) * k;
      camera.position.set(
        mix(OVERVIEW.position, chase.position, 0),
        mix(OVERVIEW.position, chase.position, 1),
        GROUND_Z + mix(OVERVIEW.position, chase.position, 2),
      );
      camera.lookAt(
        mix(OVERVIEW.target, chase.target, 0),
        mix(OVERVIEW.target, chase.target, 1),
        GROUND_Z + mix(OVERVIEW.target, chase.target, 2),
      );
    };

    const draw = () => renderer.render(scene, camera);

    // No robot for a model this console has no picture of: the set alone.
    const robot = profile ? loadRobotModel(profile.modelUrl) : null;
    robot
      ?.then((shared) => {
        if (cancelled || !profile) return;
        // A clone, sharing the geometry: its joints are this view's alone, and
        // the shared model stays whole for the dashboard after sign-in.
        model = shared.clone();
        joints = [...profile.joints].flatMap(([name, spec]) => {
          const node = model!.getObjectByName(spec.childLink);
          return node ? [{ node, axis: new THREE.Vector3(...spec.axis), name }] : [];
        });
        pose(walkAngles(profile.walk, null));
        model.updateMatrixWorld(true);
        standHeight = -new THREE.Box3().setFromObject(model).min.z;
        robotGroup.add(model);
        // Still, the scan is one whole turn at once, all of it fresh.
        if (reduced) sweep(-SWEEP_TURN_S, 0, 48);
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
        if (still || !model || document.hidden) return;
        since += dt;
        const due = since >= FRAME_S;
        if (budget.tick(dt, due) === "stop") {
          // Settle where it stands: on the robot, one fresh turn of its scan.
          still = true;
          sweep(t - SWEEP_TURN_S, t, 48);
          place();
          draw();
          return;
        }
        if (!due) return;
        // A long gap (a hidden tab come back) resumes the walk, not a jump.
        const step = Math.min(since, 0.1);
        sweep(t, t + step, FANS_PER_FRAME);
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
      lidar.dispose();
      view.dispose();
    };
  }, [resolvedTheme, profile]);

  return <div ref={containerRef} aria-hidden className={className} />;
}
