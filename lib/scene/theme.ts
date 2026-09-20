// Scene colours for the 3D viewport, as three.js hex numbers.
//
// The shared signal hues come from lib/theme/signal.ts rather than being
// transcribed again; what is written out below is what this scene adds — the
// ground, the two draft tints, the vertex family and the route — none of which
// is a console surface with a CSS token behind it.

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
   * double-click away from becoming the commanded pose — and because the gridmap
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
  },
};
