// What the robot sees and means to do around it while it drives: the costmap
// its controller steers on, and the next 2 s of its trajectory.

import * as THREE from "three";

import { createDashedRibbon } from "@/lib/scene/path-ribbon";
import type { Theme } from "@/lib/scene/theme";
import type { LocalCostmap, PlannedPath } from "@/lib/types/robot";

/*
 * Both lie on the robot's own ground (setGround), not on the floor plan or a
 * height of their own: the robot sends them planar, and they are about the
 * storey it stands on. The costmap under the route (PATH_Z_M, 0.012), so the
 * route stays readable across it; the trajectory over the route, since it is
 * the robot's next step along it.
 */
const COSTMAP_Z_M = 0.006;
const LOCAL_PLAN_Z_M = 0.02;
/* Narrower than the route (0.12) and the dock's approach, so it reads as a
 * thread through the band rather than a second band; with its rim it is
 * 0.09, which still leaves the route's cyan showing either side of it. */
const LOCAL_PLAN_WIDTH_M = 0.06;
const LOCAL_PLAN_CASING_M = 0.015;
/* Past the route's ghost, casing and core (render orders -3 to -1). */
const LOCAL_PLAN_RENDER_SHIFT = 3;

/** The robot's cost values that mean something on their own. */
export const COST_FREE = 0;
export const COST_INSCRIBED = 253;
export const COST_LETHAL = 254;
export const COST_UNKNOWN = 255;

/*
 * Opacity per cost. An obstacle reads at a glance; the cells the body must
 * not enter almost as strongly; the margin the robot keeps from an obstacle
 * fades out with the cost, so the gradient shows how much room it thinks it
 * has. Free and never-seen cells are not drawn at all: the scan and the floor
 * plan under them are what the operator reads there.
 */
const LETHAL_ALPHA = 0.85;
const INSCRIBED_ALPHA = 0.6;
const MARGIN_ALPHA_MIN = 0.08;
const MARGIN_ALPHA_MAX = 0.4;

/** The opacity a cost is drawn at, 0..1. */
export function costAlpha(cost: number): number {
  if (cost === COST_FREE || cost === COST_UNKNOWN) return 0;
  if (cost === COST_LETHAL) return LETHAL_ALPHA;
  if (cost === COST_INSCRIBED) return INSCRIBED_ALPHA;
  return MARGIN_ALPHA_MIN + (MARGIN_ALPHA_MAX - MARGIN_ALPHA_MIN) * (cost / (COST_INSCRIBED - 1));
}

/**
 * The RGBA texels for `cells`, one hue at `costAlpha`'s opacity, into `out`
 * (allocated when absent or the wrong size). Rows stay in the robot's order:
 * a DataTexture's first row is its bottom (v = 0), which is the `origin` row.
 */
export function costmapRgba(cells: Uint8Array, color: number, out?: Uint8Array): Uint8Array {
  const rgba = out && out.length === cells.length * 4 ? out : new Uint8Array(cells.length * 4);
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  for (let i = 0; i < cells.length; i++) {
    const o = i * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = Math.round(costAlpha(cells[i]!) * 255);
  }
  return rgba;
}

export interface LocalNavLayer {
  group: THREE.Group;
  /** Draw a costmap; undefined, or the `width` 0 clear, hides it. */
  setCostmap: (costmap: LocalCostmap | undefined) => void;
  /** Draw a trajectory; undefined, or an empty one, removes it. */
  setPlan: (plan: PlannedPath | undefined) => void;
  /**
   * Whether the 3D map is drawn under it, which changes the costmap's hue
   * (`localCostmapOverMap`); the costmap on screen is repainted at once.
   */
  setOverMap: (over: boolean) => void;
  /** The ground the robot stands on, map-frame metres: where both lie. */
  setGround: (z: number) => void;
  dispose: () => void;
}

/**
 * The costmap as one textured quad and the trajectory as a dashed thread, in
 * one group. Mutable rather than rebuilt per frame: the costmap arrives twice
 * a second at a fixed size, so its texture is rewritten in place, and the
 * group's height follows the robot every drawn frame.
 */
export function createLocalNavLayer(theme: Theme): LocalNavLayer {
  const group = new THREE.Group();

  // The costmap's own frame: its origin corner and its turn in the map.
  const costmapFrame = new THREE.Group();
  group.add(costmapFrame);

  // A unit quad with its corner at the origin, scaled to the grid's size, so
  // the texture's (0, 0) texel lands on the costmap's origin cell.
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0.5, 0.5, 0);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    // Its own cells blend; it must not hide the route drawn just above it.
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = COSTMAP_Z_M;
  mesh.visible = false;
  costmapFrame.add(mesh);

  let texture: THREE.DataTexture | null = null;
  // ArrayBuffer-backed, which is what a DataTexture's upload accepts.
  let texels: Uint8Array<ArrayBuffer> | null = null;
  let texWidth = 0;
  let texHeight = 0;

  let plan: ReturnType<typeof createDashedRibbon> = null;
  let costmapColor = theme.localCostmap;
  // The cells on screen, so a hue change repaints them without a new frame.
  let shownCells: Uint8Array | null = null;

  const dropPlan = () => {
    if (!plan) return;
    group.remove(plan.mesh);
    plan.dispose();
    plan = null;
  };

  return {
    group,
    setCostmap: (costmap) => {
      if (
        !costmap ||
        costmap.width === 0 ||
        costmap.height === 0 ||
        costmap.cells.length !== costmap.width * costmap.height
      ) {
        mesh.visible = false;
        shownCells = null;
        return;
      }
      if (!texture || texWidth !== costmap.width || texHeight !== costmap.height) {
        texture?.dispose();
        texWidth = costmap.width;
        texHeight = costmap.height;
        texels = new Uint8Array(texWidth * texHeight * 4);
        texture = new THREE.DataTexture(texels, texWidth, texHeight, THREE.RGBAFormat);
        // One cell is one texel: interpolating would blur an obstacle's edge
        // into the free cell beside it.
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        // The hue is an sRGB token, as every other colour in the scene.
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
      }
      costmapRgba(costmap.cells, costmapColor, texels!);
      texture.needsUpdate = true;
      shownCells = costmap.cells;

      mesh.scale.set(costmap.width * costmap.resolution, costmap.height * costmap.resolution, 1);
      costmapFrame.position.set(costmap.origin.x, costmap.origin.y, 0);
      costmapFrame.rotation.z = costmap.origin.yaw;
      mesh.visible = true;
    },
    setPlan: (next) => {
      dropPlan();
      // Two points at the least (z is carried as 0, three numbers each).
      if (!next || next.points.length < 6) return;
      plan = createDashedRibbon(next.points, theme.localPlan, {
        width: LOCAL_PLAN_WIDTH_M,
        z: LOCAL_PLAN_Z_M,
        stride: 3,
        opacity: 1,
        casing: theme.localPlanCasing,
        casingWidth: LOCAL_PLAN_CASING_M,
      });
      if (!plan) return;
      // After the route's own three draws, so where the two lie within a
      // centimetre of each other (the robot's ground and the planner's
      // differ by its drift) the thread wins rather than fighting the band.
      plan.mesh.traverse((object) => {
        object.renderOrder += LOCAL_PLAN_RENDER_SHIFT;
      });
      group.add(plan.mesh);
    },
    setOverMap: (over) => {
      const next = over ? theme.localCostmapOverMap : theme.localCostmap;
      if (next === costmapColor) return;
      costmapColor = next;
      if (shownCells && texture && texels) {
        costmapRgba(shownCells, costmapColor, texels);
        texture.needsUpdate = true;
      }
    },
    setGround: (z) => {
      group.position.z = z;
    },
    dispose: () => {
      dropPlan();
      geometry.dispose();
      material.dispose();
      // By hand: disposing the material never reaches its texture.
      texture?.dispose();
      texture = null;
    },
  };
}
