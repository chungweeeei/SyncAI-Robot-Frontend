// The sign-in screen's lidar: a fan of rays turning on the robot's head, and
// where each one lands on the made-up set. Drawn as points that fade, so the
// warehouse is scanned in as the robot walks, the way a mapping run looks.
// Heights here are over the set's ground (0), as demo-site.ts's props are.

import * as THREE from "three";

import { rampColor } from "@/lib/theme/height-ramp";

/** A box standing on the ground: centre x, y, footprint and height, metres. */
export interface SweepProp {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

/** How far a ray reaches, metres: the room, not the horizon. */
export const SWEEP_RANGE_M = 9;
/** One turn of the head, seconds. */
export const SWEEP_TURN_S = 1.2;
/** Rays in one fan, bottom to top. */
export const SWEEP_FAN = 24;
/** The fan's spread under and over level, radians: floor near the feet to the shelf tops. */
const SWEEP_DOWN = -0.62;
const SWEEP_UP = 0.42;
/** How long a point stays on screen, seconds. */
export const SWEEP_LIFE_S = 2.6;
/** The tallest prop, for the colour ramp: the ground violet, a column's top red. */
const RAMP_TOP_M = 3.2;
/**
 * Where the ground starts on the ramp: its blue, not the bottom's near-black
 * violet, which in the light theme turned the floor into a field of ink and
 * in the dark one into nothing.
 */
const RAMP_FLOOR = 0.16;

/**
 * Where a ray from `origin` along `dir` (unit length) first lands: the ground
 * or a prop's face, whichever is nearer, within SWEEP_RANGE_M. Null for a ray
 * into open air.
 */
export function castRay(
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  props: readonly SweepProp[],
): [number, number, number] | null {
  let nearest = SWEEP_RANGE_M;
  // The ground plane, z = 0.
  if (dir[2] < 0) nearest = Math.min(nearest, -origin[2] / dir[2]);
  for (const prop of props) {
    const hit = rayBox(origin, dir, prop);
    if (hit !== null && hit < nearest) nearest = hit;
  }
  if (nearest >= SWEEP_RANGE_M) return null;
  return [
    origin[0] + dir[0] * nearest,
    origin[1] + dir[1] * nearest,
    origin[2] + dir[2] * nearest,
  ];
}

/** The slab test: the distance along the ray to the box's near face, or null. */
function rayBox(
  o: readonly [number, number, number],
  d: readonly [number, number, number],
  box: SweepProp,
): number | null {
  const lo = [box.x - box.w / 2, box.y - box.d / 2, 0];
  const hi = [box.x + box.w / 2, box.y + box.d / 2, box.h];
  let enter = 0;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < lo[axis] || o[axis] > hi[axis]) return null;
      continue;
    }
    let a = (lo[axis] - o[axis]) / d[axis];
    let b = (hi[axis] - o[axis]) / d[axis];
    if (a > b) [a, b] = [b, a];
    enter = Math.max(enter, a);
    exit = Math.min(exit, b);
    if (enter > exit) return null;
  }
  return enter > 0 ? enter : null;
}

/**
 * The fan of rays the head sends `t` seconds in, from a robot heading `yaw`:
 * one vertical fan at the head's turn, so a full circle is swept every
 * SWEEP_TURN_S. Unit vectors.
 */
export function sweepFan(t: number, yaw: number): [number, number, number][] {
  const azimuth = yaw + (2 * Math.PI * t) / SWEEP_TURN_S;
  const rays: [number, number, number][] = [];
  for (let i = 0; i < SWEEP_FAN; i += 1) {
    const elevation = SWEEP_DOWN + ((SWEEP_UP - SWEEP_DOWN) * i) / (SWEEP_FAN - 1);
    const c = Math.cos(elevation);
    rays.push([Math.cos(azimuth) * c, Math.sin(azimuth) * c, Math.sin(elevation)]);
  }
  return rays;
}

export interface LidarLayer {
  points: THREE.Points;
  /** Lay down where `rays` from `origin` land, born at `time` (seconds). */
  add: (
    origin: readonly [number, number, number],
    rays: readonly (readonly [number, number, number])[],
    props: readonly SweepProp[],
    time: number,
  ) => void;
  /** Age every point to `time`: the fade is the shader's, so this is one uniform. */
  setTime: (time: number) => void;
  dispose: () => void;
}

/**
 * The points, as one ring buffer: the oldest is overwritten by the newest,
 * so the cost is fixed however long the page is open. Each point carries
 * its birth time and the shader fades it out over SWEEP_LIFE_S. Drawn at
 * `groundZ` over the scene's own ground, as the set is.
 */
export function createLidarLayer(groundZ: number, capacity = 6000): LidarLayer {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  // Born long ago: every slot starts faded out.
  const births = new Float32Array(capacity).fill(-1e6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("birth", new THREE.BufferAttribute(births, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLife: { value: SWEEP_LIFE_S } },
    vertexShader: /* glsl */ `
      attribute float birth;
      attribute vec3 color;
      uniform float uTime;
      uniform float uLife;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        float age = (uTime - birth) / uLife;
        vAlpha = clamp(1.0 - age, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Bright and big when fresh, settling as it fades; nearer is larger.
        gl_PointSize = (2.0 + 3.0 * vAlpha * vAlpha) * (6.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        if (dot(p, p) > 0.25 || vAlpha <= 0.0) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  // Its slots move every frame; a box from the first ones would cull the rest.
  points.frustumCulled = false;

  let next = 0;
  const rgb: [number, number, number] = [0, 0, 0];
  return {
    points,
    add: (origin, rays, props, time) => {
      for (const ray of rays) {
        const hit = castRay(origin, ray, props);
        if (!hit) continue;
        positions[next * 3] = hit[0];
        positions[next * 3 + 1] = hit[1];
        positions[next * 3 + 2] = hit[2] + groundZ;
        rampColor(RAMP_FLOOR + (1 - RAMP_FLOOR) * (hit[2] / RAMP_TOP_M), rgb);
        colors[next * 3] = rgb[0];
        colors[next * 3 + 1] = rgb[1];
        colors[next * 3 + 2] = rgb[2];
        births[next] = time;
        next = (next + 1) % capacity;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.birth.needsUpdate = true;
    },
    setTime: (time) => {
      material.uniforms.uTime.value = time;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
