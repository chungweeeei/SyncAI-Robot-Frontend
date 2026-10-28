// Scene colours for the 3D viewport, as three.js hex numbers. Signal hues come
// from lib/theme/signal.ts; only the hues with no CSS token are written out.

import { SIGNAL } from "@/lib/theme/signal";

// The robot itself is deliberately absent here: it renders in its own material
// so the machine looks like the same machine in either theme.
export interface Theme {
  background: number;
  /** Solid colour for the map scan, distinct from the height-coloured live scan. */
  mapCloud: number;
  /** Committed / being-dragged goal marker: `signal-cmd`, a commanded value. */
  goal: number;
  goalDraft: number;
  /** Staged initial pose: `signal-caution`, so it is never misread as a goal. */
  initialPose: number;
  initialPoseDraft: number;
  /**
   * Stored vertices, one hue for every type, not a signal colour.
   *
   * Magenta, because it is the one hue the 3D map's height ramp
   * (lib/theme/height-ramp.ts) never reaches: violet through red covers the
   * rest of the wheel, and the old dark teal sank into the violet the ramp
   * gives the floor — the very cells a stop stands on. Clear of the zones'
   * red and the dock leg's violet too. A step deeper in light; brighter in
   * dark, over the near-black well.
   */
  vertex: number;
  /**
   * The rim under a stop's ground ring. The 3D map is dark violet at the
   * floor and bright at the walls, so no one hue holds an edge against both;
   * a pale rim beside a saturated ring does, as `MARKER_HALO` does for the
   * route map's flat marks.
   */
  vertexHalo: number;
  /** The vertex under the pointer, in the commanded hue: one tap from being the goal. */
  vertexHover: number;
  /**
   * The planner's route: the goal's cyan family, since it is what the goal
   * turned into, but a step darker so the longest mark does not outshine it.
   */
  path: number;
  /**
   * The rim each side of the route, and its chevrons, pale in
   * both themes for the reason `vertexHalo` is: the 3D map's floor is the
   * ramp's dark violet, and a light rim is what holds an edge there and
   * against the bright walls alike, where the route's cyan alone sinks into
   * the ramp's own cyan.
   */
  pathCasing: number;
  /**
   * The route while the 3D map is shown, and its rim. The map's floor is
   * the ramp's violet into blue and cyan, the very hues of `path`, so the
   * route sank into the cells it runs over even with its pale rim. The
   * neutrals are the ramp's one free family, so the core goes pale and the
   * rim and chevrons dark. With the 3D map off the cyan stays.
   */
  pathOverMap: number;
  pathCasingOverMap: number;
  /**
   * The floors under the one picked on the dashboard's 3D map, drawn faint
   * for context: a neutral, since the height ramp is the floor on show's,
   * and a second ramp underneath would read as more of the same storey.
   */
  voxelGhost: number;
  /**
   * A dock's own leg: the staging point and the approach from it onto the
   * dock. Not a signal hue and not the route's cyan, so the last metre reads
   * as a different kind of driving from the route that brought the robot to
   * the staging point — the robot walks it blind, steering to the dock.
   */
  dock: number;
  /** Forbidden zones: `signal-warn`, the same mark as in the map editor. */
  zone: number;
  /**
   * What the robot itself sees around it while it drives (the costmap its
   * controller steers on): `signal-caution`, an assertion about the world.
   * Not the zones' `signal-warn`, which marks a rule the operator drew.
   */
  localCostmap: number;
  /**
   * The costmap while the 3D map is shown. Amber is the ramp's own yellow,
   * so over the map an obstacle the robot sees would read as one more wall
   * a storey up; the only hues the ramp leaves free are magenta (the
   * waypoints') and the neutrals, and the map's floor is its dark violet,
   * so a pale wash it is. With the 3D map off the amber stays.
   */
  localCostmapOverMap: number;
  /**
   * The next 2 s the robot means to drive: `signal-live`, measured and
   * happening now, apart from the route's cyan that it follows.
   */
  localPlan: number;
  /**
   * The trajectory's rim, the opposite of what it lies on: it runs down the
   * middle of the route, and `signal-live` and the route's cyan are one
   * lightness in each theme, so without it the thread dissolves into the
   * band. Dark in dark, where both are bright; white in light.
   */
  localPlanCasing: number;
}

// Tracks the console surfaces so the viewport reads as a recessed well.
export const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    background: SIGNAL.light.background,
    mapCloud: 0x54646f,
    goal: SIGNAL.light.cmd,
    goalDraft: 0x4aa6c6,
    initialPose: SIGNAL.light.caution,
    initialPoseDraft: 0xc08c33,
    vertex: 0xc2189b,
    vertexHalo: 0xffffff,
    vertexHover: SIGNAL.light.cmd,
    path: 0x2b86a8,
    pathCasing: 0xffffff,
    pathOverMap: 0xffffff,
    pathCasingOverMap: SIGNAL.dark.elevated,
    voxelGhost: 0x7d8a94,
    dock: 0x6a4fc0,
    zone: SIGNAL.light.warn,
    localCostmap: SIGNAL.light.caution,
    localCostmapOverMap: 0xffffff,
    localPlan: SIGNAL.light.live,
    localPlanCasing: 0xffffff,
  },
  dark: {
    background: SIGNAL.dark.background,
    mapCloud: 0xa7b6c1,
    goal: SIGNAL.dark.cmd,
    goalDraft: 0x8adcf7,
    initialPose: SIGNAL.dark.caution,
    initialPoseDraft: 0xf6cd7e,
    vertex: 0xff4fd2,
    vertexHalo: 0xf2f7fa,
    vertexHover: SIGNAL.dark.cmd,
    path: 0x3aa8cc,
    pathCasing: 0xf2f7fa,
    pathOverMap: 0xf2f7fa,
    pathCasingOverMap: SIGNAL.dark.background,
    voxelGhost: 0x8796a2,
    dock: 0xa991f2,
    zone: SIGNAL.dark.warn,
    localCostmap: SIGNAL.dark.caution,
    localCostmapOverMap: 0xf2f7fa,
    localPlan: SIGNAL.dark.live,
    localPlanCasing: SIGNAL.dark.background,
  },
};
