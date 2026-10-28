// What the robot sees and means to do around it while it drives: the costmap
// its controller steers on, and the next 2 s of its trajectory.

import * as THREE from "three";

import { createDashedRibbon } from "@/lib/scene/path-ribbon";
import type { Theme } from "@/lib/scene/theme";
import type { LocalCostmap, PlannedPath } from "@/lib/types/robot";

/*
 * Both lie on the robot's own ground (setGround), not on the ground floor or a
 * height of their own: the robot sends them planar, and they are about the
 * storey it stands on. With the 3D map up the costmap is draped over the
 * ground it shows instead (setSurface), since one plane at the robot's feet
 * cut into a slope ahead and floated over one behind. The costmap under the
 * route (PATH_Z_M, 0.012), so the route stays readable across it; the
 * trajectory over the route, since it is the robot's next step along it.
 */
const COSTMAP_Z_M = 0.006;
/*
 * The drape's vertex spacing, metres: the 3D map's own cell (0.1 m on every
 * map so far), so each column's ground gets a vertex and nothing finer is
 * invented between them. A 4 m costmap is 41 x 41 vertices, re-read twice a
 * second.
 */
const DRAPE_STEP_M = 0.1;
/*
 * How far from the robot's ground a vertex looks for the map's, metres. The
 * costmap reaches 2.8 m from the robot at its corners, a 20 degree slope (the
 * steepest the planner takes) rises 1.0 m over it; a storey's slab is three
 * times as far, so the floor above or below is never taken for this one.
 */
const DRAPE_REACH_M = 1.0;
/* As the route's band (path-ribbon.ts): the floor's sprites stand up through
 * a sheet at their tops from any oblique view. */
const POLYGON_OFFSET = -4;
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

/**
 * The ground under a map-frame point nearest the height `z`, searched `reach`
 * either side of it, metres; null where the map shows none in reach.
 */
export type SurfaceSampler = (wx: number, wy: number, z: number, reach: number) => number | null;

/**
 * Heights for a `cols` x `rows` vertex lattice (row-major, `samples`' order),
 * with every vertex the map had no ground for filled in from its neighbours:
 * a wall's column or a hole would otherwise pull the sheet down to the robot's
 * ground in a spike. Spread outward one ring a pass, the mean of the known
 * 4-neighbours; what is left after `cols + rows` passes has no known vertex
 * anywhere and takes `fallback`.
 */
export function fillHeights(
  samples: (number | null)[],
  cols: number,
  rows: number,
  fallback: number,
): Float32Array {
  const heights = new Float32Array(samples.length);
  const known = new Uint8Array(samples.length);
  samples.forEach((h, i) => {
    if (h !== null) {
      heights[i] = h;
      known[i] = 1;
    }
  });
  for (let pass = 0; pass < cols + rows; pass++) {
    const next: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (known[i]) continue;
        let sum = 0;
        let n = 0;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const cc = c + dc;
          const rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const j = rr * cols + cc;
          if (known[j]) {
            sum += heights[j];
            n++;
          }
        }
        if (n) next.push([i, sum / n]);
      }
    }
    if (!next.length) break;
    for (const [i, h] of next) {
      heights[i] = h;
      known[i] = 1;
    }
  }
  for (let i = 0; i < heights.length; i++) if (!known[i]) heights[i] = fallback;
  return heights;
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
  /**
   * The 3D map's ground, which the costmap is draped over from its next
   * frame; null lays it flat on the robot's ground again, at once.
   */
  setSurface: (sample: SurfaceSampler | null) => void;
  dispose: () => void;
}

/**
 * The costmap as one textured sheet and the trajectory as a dashed thread, in
 * one group. Mutable rather than rebuilt per frame: the costmap arrives twice
 * a second at a fixed size, so its texture is rewritten in place, and the
 * group's height follows the robot every drawn frame. Draped, the sheet's
 * vertices carry map-frame heights, and its frame cancels the group's.
 */
export function createLocalNavLayer(theme: Theme): LocalNavLayer {
  const group = new THREE.Group();

  // The costmap's own frame: its origin corner and its turn in the map.
  const costmapFrame = new THREE.Group();
  group.add(costmapFrame);

  // A sheet in metres with its corner at the origin, so the texture's (0, 0)
  // texel lands on the costmap's origin cell: one quad flat, a lattice of
  // DRAPE_STEP_M draped.
  const makeSheet = (sizeX: number, sizeY: number, cols: number, rows: number) => {
    const sheet = new THREE.PlaneGeometry(sizeX, sizeY, cols, rows);
    sheet.translate(sizeX / 2, sizeY / 2, 0);
    return sheet;
  };
  let geometry = makeSheet(1, 1, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    // Its own cells blend; it must not hide the route drawn just above it.
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: POLYGON_OFFSET,
    polygonOffsetUnits: POLYGON_OFFSET,
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
  let surface: SurfaceSampler | null = null;
  let shownCostmap: LocalCostmap | null = null;
  let ground = 0;
  let draped = false;
  // The sheet's size and lattice, so a costmap of the same shape reuses it.
  let sheetKey = "";

  /** The sheet for `costmap`: flat, or draped over `surface` at map heights. */
  const shapeSheet = (costmap: LocalCostmap) => {
    const sizeX = costmap.width * costmap.resolution;
    const sizeY = costmap.height * costmap.resolution;
    const cols = surface ? Math.max(1, Math.round(sizeX / DRAPE_STEP_M)) : 1;
    const rows = surface ? Math.max(1, Math.round(sizeY / DRAPE_STEP_M)) : 1;
    const key = `${sizeX}:${sizeY}:${cols}:${rows}`;
    if (key !== sheetKey) {
      geometry.dispose();
      geometry = makeSheet(sizeX, sizeY, cols, rows);
      mesh.geometry = geometry;
      sheetKey = key;
    }
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    if (!surface) {
      for (let i = 0; i < position.count; i++) position.setZ(i, 0);
      position.needsUpdate = true;
      draped = false;
      costmapFrame.position.z = 0;
      return;
    }
    const cos = Math.cos(costmap.origin.yaw);
    const sin = Math.sin(costmap.origin.yaw);
    const samples: (number | null)[] = [];
    for (let i = 0; i < position.count; i++) {
      const lx = position.getX(i);
      const ly = position.getY(i);
      samples.push(
        surface(
          costmap.origin.x + cos * lx - sin * ly,
          costmap.origin.y + sin * lx + cos * ly,
          ground,
          DRAPE_REACH_M,
        ),
      );
    }
    // PlaneGeometry's vertices run row by row, cols + 1 to a row.
    const heights = fillHeights(samples, cols + 1, rows + 1, ground);
    for (let i = 0; i < position.count; i++) position.setZ(i, heights[i]);
    position.needsUpdate = true;
    geometry.computeBoundingSphere();
    draped = true;
    costmapFrame.position.z = -ground;
  };

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
        shownCostmap = null;
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

      costmapFrame.position.set(costmap.origin.x, costmap.origin.y, 0);
      costmapFrame.rotation.z = costmap.origin.yaw;
      shapeSheet(costmap);
      shownCostmap = costmap;
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
      ground = z;
      // Draped, the sheet's heights are the map's: the group's lift is undone.
      if (draped) costmapFrame.position.z = -z;
    },
    setSurface: (sample) => {
      surface = sample;
      // Off the map at once; onto it with the next costmap, which comes
      // within half a second while a navigation runs.
      if (!sample && shownCostmap) shapeSheet(shownCostmap);
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
