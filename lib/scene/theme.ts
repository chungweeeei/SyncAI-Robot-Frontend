// Scene colours for the 3D viewport, as three.js hex numbers. Signal hues come
// from lib/theme/signal.ts; only the hues with no CSS token are written out.

import { SIGNAL } from "@/lib/theme/signal";

// The robot itself is deliberately absent here: it renders in its own material
// so the machine looks like the same machine in either theme.
export interface Theme {
  background: number;
  ground: number;
  groundOpacity: number;
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
   * Dark in both themes, unlike the editor's `PALETTES.vertex`: there is no
   * halo here, and the floor plan texture is white in either theme. Mid-toned
   * rather than ink, because a map with no floor plan falls back onto the
   * near-black background.
   */
  vertex: number;
  /** The vertex under the pointer, in the commanded hue: one tap from being the goal. */
  vertexHover: number;
  /**
   * The planner's route: the goal's cyan family, since it is what the goal
   * turned into, but a step darker so the longest mark does not outshine it.
   */
  path: number;
  /** Forbidden zones: `signal-warn`, the same mark as on the floor plan editor. */
  zone: number;
  /**
   * The floor plan's opacity while the 3D map is shown. The robot's floor
   * lies about half a metre under the plane the floor plan is drawn on (the
   * map frame's zero is the body, not the ground), so at full opacity the
   * plane hides the whole map from every angle above it. Thinned rather than
   * lifted out of the way: the floor plan is still the reference the stops
   * and zones sit on. The map itself is coloured by lib/theme/height-ramp.ts.
   */
  groundOpacityUnderVoxels: number;
}

// Tracks the console surfaces so the viewport reads as a recessed well.
export const THEMES: Record<"light" | "dark", Theme> = {
  light: {
    background: SIGNAL.light.background,
    ground: 0xffffff,
    groundOpacity: 0.85,
    mapCloud: 0x54646f,
    goal: SIGNAL.light.cmd,
    goalDraft: 0x4aa6c6,
    initialPose: SIGNAL.light.caution,
    initialPoseDraft: 0xc08c33,
    vertex: 0x173845,
    vertexHover: SIGNAL.light.cmd,
    path: 0x2b86a8,
    zone: SIGNAL.light.warn,
    groundOpacityUnderVoxels: 0.35,
  },
  dark: {
    background: SIGNAL.dark.background,
    ground: SIGNAL.dark.elevated,
    groundOpacity: 0.6,
    mapCloud: 0xa7b6c1,
    goal: SIGNAL.dark.cmd,
    goalDraft: 0x8adcf7,
    initialPose: SIGNAL.dark.caution,
    initialPoseDraft: 0xf6cd7e,
    vertex: 0x2b5f77,
    vertexHover: SIGNAL.dark.cmd,
    path: 0x3aa8cc,
    zone: SIGNAL.dark.warn,
    groundOpacityUnderVoxels: 0.3,
  },
};
