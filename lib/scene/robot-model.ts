// The robot's mesh: one cached load per model and page, shared by every
// scene rebuild.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Load a robot model (a profile's `modelUrl`) once per page load: the scene
 * is rebuilt on every map or theme change, and reparsing a ~600 kB GLB each
 * time is waste.
 *
 * Baked by scripts/urdf2glb.py in the ROS convention (Z-up, +x forward,
 * metres), not glTF's +Y-up, so the Z-up scene needs no correction rotation.
 *
 * The GLB has no materials or normals; glTF's default material would render
 * pure black here, so every mesh gets our own flat-shaded one.
 *
 * Graphite, not the pale grey it was: the 3D map's cells are the height
 * ramp's bright greens and yellows and the light theme's background is
 * near white, and a pale body sank into both (robot01, 2026-11-20). The
 * camera's own light (pointcloud-canvas) keeps its facets from going black.
 * An outline of its creases and an x-ray through the map were tried and
 * dropped: the mesh is 200k faceted triangles, so the outline was 165k line
 * segments and the x-ray a second full draw, which starved the page on a
 * software GPU — CI's, and a weak laptop's.
 */
const robotModels = new Map<string, Promise<THREE.Object3D>>();

export function loadRobotModel(url: string): Promise<THREE.Object3D> {
  let robotModelPromise = robotModels.get(url);
  if (!robotModelPromise) {
    const loader = new GLTFLoader();
    // scripts/urdf2glb.py runs gltfpack -cc, whose output declares
    // EXT_meshopt_compression. (KHR_mesh_quantization needs no registration.)
    loader.setMeshoptDecoder(MeshoptDecoder);
    robotModelPromise = loader.loadAsync(url).then((gltf) => {
      const material = new THREE.MeshStandardMaterial({
        color: 0x5a636d,
        metalness: 0.1,
        roughness: 0.75,
        // No NORMAL attribute in the asset, so shade off face derivatives.
        flatShading: true,
      });
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) mesh.material = material;
      });
      return gltf.scene;
    });
    robotModels.set(url, robotModelPromise);
  }
  return robotModelPromise;
}

/**
 * Joint names in a `joints` prop that the robot's joint table does not know, warned once
 * each: a mismatch would otherwise fail silently as a leg that never moves
 * (kJointNames in syncai_driver_manager.cpp still has a TODO on its order).
 */
export const warnedUnknownJoints = new Set<string>();
