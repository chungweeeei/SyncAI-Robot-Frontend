// The G23 mesh: one cached load per page, shared by every scene rebuild.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// G23 model baked from description/G23.urdf by scripts/urdf2glb.py. It keeps
// the ROS convention (Z-up, +x forward, metres) rather than glTF's nominal
// +Y-up, which is exactly what the Z-up world in
// components/dashboard/pointcloud-canvas.tsx expects — so it needs no
// correction rotation. See that script's docstring.
const ROBOT_MODEL_URL = "/models/g23.glb";

// Height of base_link above the ground with the legs at the rest pose the GLB
// is baked in: 0.41012 m of link offsets down to FL_FOOT, plus the 22 mm foot
// collision sphere the URDF uses as the contact point. The pose feed reports a
// planar pose (lio_bridge projects to x/y/yaw, so z is ~0), so without this the
// robot renders buried to its knees.
export const ROBOT_BASE_HEIGHT_M = 0.43212;


/**
 * Load the robot model once per page load.
 *
 * PointCloudCanvas's scene-setup effect tears down and rebuilds the renderer
 * whenever the map or the theme changes, and refetching plus reparsing a ~600 kB GLB on
 * every theme toggle is pure waste. Caching the promise at module scope is the
 * same move the body_cloud WebSocket already makes for the same reason.
 *
 * The GLB carries geometry only — no materials, and no vertex normals (STL has
 * none to carry over, and generating them would inflate the asset for a
 * mechanical part that reads fine flat-shaded). Left alone, glTF's default
 * material is fully metallic and would render pure black in this deliberately
 * unlit scene, so every mesh gets our own lit material here.
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
 * Joint names seen in a `joints` prop that G23_JOINTS does not know. Warned
 * once each (module scope, like the model cache): a name mismatch between the
 * telemetry source and the URDF would otherwise fail silently as a leg that
 * never moves — and kJointNames in syncai_driver_manager.cpp still carries a
 * TODO about its ordering, so a mismatch is a live possibility.
 */
export const warnedUnknownJoints = new Set<string>();
