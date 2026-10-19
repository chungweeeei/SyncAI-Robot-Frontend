import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { EDL_LAYER, EDL_STEP_CELLS, createEdlPass } from "@/lib/scene/edl";

interface RenderCall {
  target: THREE.WebGLRenderTarget | null;
  scene: THREE.Scene;
  /** The camera's layers, what the clear would be and the background, as drawn. */
  mask: number;
  autoClear: boolean;
  background: THREE.Scene["background"];
}

/** The renderer calls the pass makes, recorded; no WebGL in jsdom. */
function fakeRenderer() {
  const calls: RenderCall[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    autoClear: true,
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
    }),
    render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      calls.push({
        target,
        scene,
        mask: camera.layers.mask,
        autoClear: renderer.autoClear,
        background: scene.background,
      });
    }),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls };
}

/** The shading material a pass draws its screen with. */
function screenMaterial(calls: RenderCall[]): THREE.ShaderMaterial {
  const screen = calls.find((call) => call.target === null && call.scene.children.length === 1)!;
  return (screen.scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
}

describe("createEdlPass", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  it("draws the scene offscreen, then the shaded screen onto the canvas", () => {
    const pass = createEdlPass(0.1);
    const { renderer, calls } = fakeRenderer();
    pass.render(renderer, scene, camera);

    expect(calls).toHaveLength(2);
    expect(calls[0].scene).toBe(scene);
    expect(calls[0].target).not.toBeNull();
    expect(calls[1].scene).not.toBe(scene);
    expect(calls[1].target).toBeNull();
    pass.dispose();
  });

  it("draws the scene straight to the canvas while off", () => {
    const pass = createEdlPass(0.1);
    pass.enabled = false;
    const { renderer, calls } = fakeRenderer();
    pass.render(renderer, scene, camera);

    expect(calls.map(({ target, scene }) => ({ target, scene }))).toEqual([{ target: null, scene }]);
    pass.dispose();
  });

  it("with a layer, shades only that layer and draws the rest over it", () => {
    const pass = createEdlPass(0.1, { layer: EDL_LAYER });
    const { renderer, calls } = fakeRenderer();
    const background = new THREE.Color(0x123456);
    const layered = new THREE.Scene();
    layered.background = background;
    const seeing = new THREE.PerspectiveCamera();
    seeing.layers.enable(EDL_LAYER);
    const both = seeing.layers.mask;
    pass.render(renderer, layered, seeing);

    expect(calls).toHaveLength(3);
    // The map alone, offscreen, on the background its gaps show.
    expect(calls[0]).toMatchObject({ scene: layered, mask: 1 << EDL_LAYER, background });
    expect(calls[0].target).not.toBeNull();
    expect(calls[1]).toMatchObject({ target: null });
    // The rest on the canvas, without a clear or a background to wipe it.
    expect(calls[2]).toMatchObject({
      target: null,
      scene: layered,
      mask: both & ~(1 << EDL_LAYER),
      autoClear: false,
      background: null,
    });
    // And all of it put back for the next draw and the picking.
    expect(seeing.layers.mask).toBe(both);
    expect(renderer.autoClear).toBe(true);
    expect(layered.background).toBe(background);
    pass.dispose();
  });

  it("with a layer, leaves its depth on the canvas, so the rest is hidden behind it", () => {
    const { renderer, calls } = fakeRenderer();
    createEdlPass(0.1, { layer: EDL_LAYER }).render(renderer, scene, camera);
    const layered = screenMaterial(calls);
    expect(layered.defines).toHaveProperty("WRITE_DEPTH");
    expect([layered.depthTest, layered.depthWrite, layered.depthFunc]).toEqual([
      true,
      true,
      THREE.AlwaysDepth,
    ]);

    // The whole scene through it has nothing left to draw after, and writes none.
    calls.length = 0;
    createEdlPass(0.1).render(renderer, scene, camera);
    const whole = screenMaterial(calls);
    expect(whole.defines).not.toHaveProperty("WRITE_DEPTH");
    expect(whole.depthWrite).toBe(false);
  });

  it("reads a step in cells of the map, so a finer map draws finer steps", () => {
    const { renderer, calls } = fakeRenderer();
    const steps = [0.05, 0.1, 0.2].map((res) => {
      const pass = createEdlPass(res);
      pass.render(renderer, scene, camera);
      const screen = calls[calls.length - 1].scene;
      const material = (screen.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
      pass.dispose();
      return material.uniforms.stepM.value as number;
    });
    expect(steps[0]).toBeCloseTo(0.05 * EDL_STEP_CELLS);
    expect(steps[1]).toBeCloseTo(0.15);
    expect(steps[2]).toBeCloseTo(0.2 * EDL_STEP_CELLS);
  });

  it("keeps its colour in 8-bit sRGB, as the canvas is", () => {
    const pass = createEdlPass(0.1);
    const { renderer, calls } = fakeRenderer();
    pass.render(renderer, scene, camera);
    const target = calls[0].target!;
    expect(target.texture.type).toBe(THREE.UnsignedByteType);
    expect(target.texture.colorSpace).toBe(THREE.SRGBColorSpace);
    pass.dispose();
  });

  it("sizes its target in device pixels", () => {
    const pass = createEdlPass(0.1);
    const { renderer, calls } = fakeRenderer();
    pass.setSize(400, 300, 2);
    pass.render(renderer, scene, camera);

    const target = calls[0].target!;
    expect([target.width, target.height]).toEqual([800, 600]);
    pass.dispose();
  });
});
