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
 * The smallest depth step that draws a line, in cells of the map: one and a
 * half, so a single cell's roughness on a floor never does and a kerb two
 * cells high always does, whatever resolution the robot built the map at.
 * 0.15 m on the robot's 0.1 m maps.
 */
export const EDL_STEP_CELLS = 1.5;
/**
 * How much the step grows per metre of distance, metres: a pixel covers more
 * of a floor the further off it is, so a grazing floor far away differs from
 * pixel to pixel by more than one near by. Set by the screen, not the map.
 */
export const EDL_STEP_PER_M = 0.003;

/**
 * The layer the dashboard puts its 3D map on, so only the map is shaded:
 * the viewport draws a robot, a live scan and markers beside it, and each
 * scan point outlined against the floor behind it would be a dark ring.
 */
export const EDL_LAYER = 1;

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
 *    (`stepM` + `stepPerM` per metre), not as Potree's log-depth sum: at
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
uniform float stepM;
uniform float stepPerM;
uniform vec2 neighbours[8];
varying vec2 vUv;

// The eye distance in metres; background (nothing drawn) is flagged by -1.
float eyeDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return -1.0;
  return -perspectiveDepthToViewZ(d, near, far);
}

void main() {
  #ifdef WRITE_DEPTH
  gl_FragDepth = texture2D(tDepth, vUv).x;
  #endif
  vec4 color = texture2D(tColor, vUv);
  float depth = eyeDepth(vUv);
  if (depth < 0.0) {
    gl_FragColor = vec4(color.rgb, 1.0);
    #include <colorspace_fragment>
    return;
  }
  float step = stepM + stepPerM * depth;
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
 * One EDL pass for one canvas, for a map of cell size `res` metres: the
 * scene into an offscreen colour + depth target, then a full-screen
 * triangle that shades the colour by the depth. Multisampled, as the canvas
 * is (WebGL2 resolves the depth too).
 *
 * With a `layer`, only the objects on it go through the pass, and the rest
 * of the scene is drawn over the shaded picture afterwards. The triangle
 * hands the layer's depth to the canvas with its colour, so what is drawn
 * after is still hidden behind the map as it would be in one render. The
 * camera has to see the layer itself, for the draws made while off.
 *
 * The colour target is 8-bit sRGB, as the canvas is: the scene is flat
 * colours with no lighting to keep headroom for, and half floats at 4x MSAA
 * on a dense screen were twice the memory traffic for nothing. sRGB rather
 * than linear so the dark end of the ramp keeps its steps.
 */
export function createEdlPass(res: number, { layer }: { layer?: number } = {}): EdlPass {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
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
      stepM: { value: EDL_STEP_CELLS * res },
      stepPerM: { value: EDL_STEP_PER_M },
      neighbours: { value: NEIGHBOURS.map(([x, y]) => new THREE.Vector2(x, y)) },
    },
    defines: layer === undefined ? {} : { WRITE_DEPTH: "" },
    // Depth is only written with the test on, so a layer's pass tests and
    // always passes.
    depthTest: layer !== undefined,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: layer !== undefined,
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
      const mask = camera.layers.mask;
      if (layer !== undefined) camera.layers.set(layer);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      material.uniforms.near.value = camera.near;
      material.uniforms.far.value = camera.far;
      renderer.render(screen, screenCamera);
      if (layer === undefined) return;

      // The rest over it, without the clear: three clears for a colour
      // background whatever autoClear says, which would wipe the map.
      camera.layers.mask = mask;
      camera.layers.disable(layer);
      const background = scene.background;
      const autoClear = renderer.autoClear;
      scene.background = null;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
      scene.background = background;
      camera.layers.mask = mask;
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
