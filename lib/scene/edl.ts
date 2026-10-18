// Eye-dome lighting: the shading point-cloud viewers (Potree, CloudCompare)
// give a cloud that has no surfaces to light. The 3D map is a million
// unlit points, so from above a floor and the top of a wall are one flat
// colour and only the height ramp tells them apart; EDL darkens each pixel
// by how far it sits behind its neighbours, which draws every wall, step and
// doorway an outline without a normal or a light anywhere.

import * as THREE from "three";

/** How far apart the neighbours compared are, in device pixels. */
export const EDL_RADIUS_PX = 1.4;
/**
 * How dark a pixel with every neighbour in front of it gets: 0.85 leaves a
 * trace of its colour, so a deep corner still reads as the height it is at.
 */
export const EDL_STRENGTH = 0.85;

/**
 * The eight neighbours, at unit distance. Diagonals included, so a wall
 * seen at any angle is outlined evenly.
 */
const NEIGHBOURS = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/*
 * EDL after Potree's, tuned for voxels. A pixel is darkened by how many of
 * its neighbours stand in front of it by more than a step — a wall's top
 * over the floor behind it, a stair's edge — so each such edge gets a dark
 * line on its far side. Two departures, both because a voxel map is a lattice
 * of square sprites rather than a scan's scattered points:
 *  - Steps are read in metres against a threshold that grows with distance
 *    (`STEP_M` + `STEP_PER_M` per metre), not as Potree's log-depth sum: at
 *    a grazing angle neighbouring rows of one floor differ by a few
 *    centimetres per pixel, which Potree's gain turns into stripes.
 *  - Background is never darkened. Potree outlines the silhouette by shading
 *    background beside a point, but the gaps between sprites are background
 *    too, and every one became a black line.
 */
const FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float near;
uniform float far;
uniform float radius;
uniform float strength;
uniform vec2 neighbours[8];
varying vec2 vUv;

const float STEP_M = 0.15;
const float STEP_PER_M = 0.003;

// The eye distance in metres; background (nothing drawn) is flagged by -1.
float eyeDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return -1.0;
  return -perspectiveDepthToViewZ(d, near, far);
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  float depth = eyeDepth(vUv);
  if (depth < 0.0) {
    gl_FragColor = vec4(color.rgb, 1.0);
    #include <colorspace_fragment>
    return;
  }
  float step = STEP_M + STEP_PER_M * depth;
  float occluded = 0.0;
  for (int i = 0; i < 8; i++) {
    float n = eyeDepth(vUv + neighbours[i] * radius * texel);
    if (n < 0.0) continue;
    occluded += smoothstep(step, step * 2.0, depth - n);
  }
  float shade = 1.0 - strength * (occluded / 8.0);
  gl_FragColor = vec4(color.rgb * shade, 1.0);
  #include <colorspace_fragment>
}
`;

export interface EdlPass {
  /** Draw `scene` through the pass, or straight to the canvas while off. */
  render: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void;
  /** Follow the canvas: its size in CSS pixels and the renderer's pixel ratio. */
  setSize: (width: number, height: number, pixelRatio: number) => void;
  enabled: boolean;
  dispose: () => void;
}

/**
 * One EDL pass for one canvas: the scene into an offscreen colour + depth
 * target, then a full-screen triangle that shades the colour by the depth.
 * Multisampled, as the canvas is (WebGL2 resolves the depth too).
 */
export function createEdlPass(): EdlPass {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    // The canvas's own antialias fills the sub-pixel gaps between sprites;
    // drawn offscreen without it, every row of floor shows a line of
    // background through them.
    samples: 4,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      tColor: { value: target.texture },
      tDepth: { value: target.depthTexture },
      texel: { value: new THREE.Vector2(1, 1) },
      near: { value: 0.1 },
      far: { value: 1000 },
      radius: { value: EDL_RADIUS_PX },
      strength: { value: EDL_STRENGTH },
      neighbours: { value: NEIGHBOURS.map(([x, y]) => new THREE.Vector2(x, y)) },
    },
    depthTest: false,
    depthWrite: false,
  });
  // One triangle over the whole screen, in clip space.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const screen = new THREE.Scene();
  screen.add(quad);
  const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const pass: EdlPass = {
    enabled: true,
    render: (renderer, scene, camera) => {
      if (!pass.enabled) {
        renderer.render(scene, camera);
        return;
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      material.uniforms.near.value = camera.near;
      material.uniforms.far.value = camera.far;
      renderer.render(screen, screenCamera);
    },
    setSize: (width, height, pixelRatio) => {
      const w = Math.max(1, Math.round(width * pixelRatio));
      const h = Math.max(1, Math.round(height * pixelRatio));
      target.setSize(w, h);
      material.uniforms.texel.value.set(1 / w, 1 / h);
    },
    dispose: () => {
      target.depthTexture?.dispose();
      target.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
  return pass;
}
