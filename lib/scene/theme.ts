// Scene colours for the 3D viewport, as three.js hex numbers.
//
// The shared signal hues come from lib/theme/signal.ts rather than being
// transcribed again; what is written out below is what this scene adds — the
// ground, the two draft tints, the vertex family and the route — none of which
// is a console surface with a CSS token behind it. The forbidden zones' hue is
// a signal one, and so is not written out.

import { SIGNAL } from "@/lib/theme/signal";

// The robot itself is deliberately absent here: it renders in its own material
// so the machine looks like the same machine in either theme.
export interface Theme {
  background: number;
  ground: number;
  groundOpacity: number;
  /** Solid colour for the static map cloud, kept distinct from the
   *  height-coloured body cloud. White on the dark background; a dark grey on
   *  the near-white light background so it stays visible in both themes. */
  mapCloud: number;
  /** Committed / being-dragged goal marker. `signal-cmd` cyan from globals.css:
   *  a goal is a commanded value, and it is the same cyan in the goal readback
   *  and on the Send button. */
  goal: number;
  goalDraft: number;
  /** Staged initial-pose marker. `signal-caution` amber, matching its control:
   *  it asserts where the robot *is*, not where it should go, and the two must
   *  never be misread for each other on the floor. */
  initialPose: number;
  initialPoseDraft: number;
  /**
   * Stored map vertices. One hue for all five types, deliberately not a signal
   * colour: see lib/map/vertex.ts on why the type is a glyph.
   *
   * Both themes get a *dark* hue, which is where this parts company with the
   * gridmap editor's `PALETTES.vertex` (lib/map/draw.ts) — the
   * two agree on the family, not on the value. The editor can flip to a light
   * marker in night mode because it draws its own halo behind every mark; here
   * the marker lies on a ground plane textured with the occupancy grid, which is
   * white free space in *either* theme (lib/map/render.ts blits the bytes
   * literally). The editor's dark-theme hue put a light mark on that white
   * floor, which is how a stop became something you had to go looking for.
   *
   * The dark value is still mid-toned rather than ink, because a map that has
   * not been converted to a gridmap has no ground plane at all and the mark
   * falls back onto the near-black background.
   */
  vertex: number;
  /**
   * The vertex under the pointer. The commanded hue, because that stop is one
   * tap away from becoming the commanded pose — and because the gridmap
   * editor already lights its selected vertex in `palette.cmd`.
   */
  vertexHover: number;
  /**
   * The planner's route. In the goal's cyan family on purpose: the route is what
   * the commanded pose turned into, and reading it as a separate kind of thing
   * would hide that. But deliberately a step *darker* than `goal` — the route is
   * the longest mark on the floor by far, and at the goal's brightness it takes
   * the eye off the pose that was actually commanded.
   */
  path: number;
  /**
   * Forbidden zones. `signal-warn`, the hue the floor plan editor draws them
   * in (lib/map/draw.ts): a zone is the one mark on this floor that says
   * "not here", and it has to be the same mark on both maps.
   */
  zone: number;
  /**
   * The 3D map's walkable floor. A muted green, off every signal hue on
   * purpose: it is static survey data, not a live state, and it must not be
   * read as the route (cyan), a zone (red) or a stop (teal) lying on it.
   */
  voxelFloor: number;
  /**
   * The 3D map's walls. A blue-grey near `mapCloud` but a step apart from it,
   * so the walls and the saved scan — the same surfaces seen two ways — read
   * as related without merging when both layers are on.
   */
  voxelWall: number;
  /**
   * The floor plan's opacity while the 3D map is shown. The robot's floor
   * lies about half a metre under the plane the floor plan is drawn on (the
   * map frame's zero is the body, not the ground), so at full opacity the
   * plane hides the floor layer from every angle above it. Thinned rather
   * than lifted out of the way: the floor plan is still the reference the
   * stops and zones sit on.
   */
  groundOpacityUnderVoxels: number;
}

// Scene colours track the console surfaces so the viewport reads as a recessed
// well in the panel rather than a pasted-in canvas. The ones that ARE a console
// surface come from SIGNAL and are not transcribed again here; what is written
// out below has no CSS token behind it.
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
    voxelFloor: 0x5e9c7a,
    voxelWall: 0x6b7a88,
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
    voxelFloor: 0x4f8f6e,
    voxelWall: 0x8da0b3,
    groundOpacityUnderVoxels: 0.3,
  },
};
