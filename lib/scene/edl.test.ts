import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { EDL_STEP_CELLS, createEdlPass } from "@/lib/scene/edl";

/** The two renderer calls the pass makes, recorded; no WebGL in jsdom. */
function fakeRenderer() {
  const calls: Array<{ target: THREE.WebGLRenderTarget | null; scene: THREE.Scene }> = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => {
      target = next;
    }),
    render: vi.fn((scene: THREE.Scene) => {
      calls.push({ target, scene });
    }),
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, calls };
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

    expect(calls).toEqual([{ target: null, scene }]);
    pass.dispose();
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
