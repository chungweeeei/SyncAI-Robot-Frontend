// The G23 mesh: one cached load per page, shared by every scene rebuild.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Baked by scripts/urdf2glb.py in the ROS convention (Z-up, +x forward,
// metres), not glTF's +Y-up, so the Z-up scene needs no correction rotation.
const ROBOT_MODEL_URL = "/models/g23.glb";

// base_link height at the GLB's rest pose (link offsets to the foot plus the
// 22 mm foot sphere). The pose feed is planar (z ~0), so without this the robot
// renders buried to its knees.
export const ROBOT_BASE_HEIGHT_M = 0.43212;


/**
 * Load the robot model once per page load: the scene is rebuilt on every map
 * or theme change, and reparsing a ~600 kB GLB each time is waste.
 *
 * The GLB has no materials or normals; glTF's default material would render
 * pure black here, so every mesh gets our own flat-shaded one.
 */
let robotModelPromise: Promise<THREE.Object3D> | null = null;

export function loadRobotModel(): Promise<THREE.Object3D> {
  if (!robotModelPromise) {
    const loader = new GLTFLoader();
    // scripts/urdf2glb.py runs gltfpack -cc, whose output declares
    // EXT_meshopt_compression. (KHR_mesh_quantization needs no registration.)
    loader.setMeshoptDecoder(MeshoptDecoder);
    robotModelPromise = loader.loadAsync(ROBOT_MODEL_URL).then((gltf) => {
      const material = new THREE.MeshStandardMaterial({
        color: 0xb0b4ba,
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
  }
  return robotModelPromise;
}

/**
 * Joint names in a `joints` prop that G23_JOINTS does not know, warned once
 * each: a mismatch would otherwise fail silently as a leg that never moves
 * (kJointNames in syncai_driver_manager.cpp still has a TODO on its order).
 */
export const warnedUnknownJoints = new Set<string>();
