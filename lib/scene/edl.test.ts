import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createEdlPass } from "@/lib/scene/edl";

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
    const pass = createEdlPass();
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
    const pass = createEdlPass();
    pass.enabled = false;
    const { renderer, calls } = fakeRenderer();
    pass.render(renderer, scene, camera);

    expect(calls).toEqual([{ target: null, scene }]);
    pass.dispose();
  });

  it("sizes its target in device pixels", () => {
    const pass = createEdlPass();
    const { renderer, calls } = fakeRenderer();
    pass.setSize(400, 300, 2);
    pass.render(renderer, scene, camera);

    const target = calls[0].target!;
    expect([target.width, target.height]).toEqual([800, 600]);
    pass.dispose();
  });
});
