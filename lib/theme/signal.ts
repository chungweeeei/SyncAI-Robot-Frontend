/**
 * The console's signal hues and surfaces, as the two canvases need them.
 *
 * These values live in `app/globals.css` as custom properties and are the
 * single source for every DOM surface. A `<canvas>` cannot read a CSS variable
 * — three.js wants a number, the 2D context wants a string — so both canvases
 * used to carry their own transcription, in two different notations, with a
 * "keep in sync with globals.css" comment apiece. That made three places to
 * change a colour and no way to tell when one had been missed.
 *
 * This is the second one, and now the only one: `lib/scene/theme.ts` derives
 * its hex numbers from here and `lib/map/draw.ts` its CSS strings, so a token
 * moved in globals.css is a two-file change with the second file named by the
 * first. Reading the computed stylesheet at runtime would collapse it to one,
 * but the scene is built before paint and a miss there is a black viewport, not
 * a slightly wrong hue.
 *
 * Only the tokens a canvas actually draws with are here. The rest of the
 * palette has no business outside CSS.
 */

export type ThemeMode = "light" | "dark";

interface SignalTokens {
  /** `--background`: the page under everything. */
  background: number;
  /**
   * `--elevated`: a raised surface.
   *
   * The 3D scene uses it for the dark ground plane and the gridmap editor for
   * the light well outside the map. The editor's *dark* well deliberately does
   * not read this token — it is a shade lighter, so the map's near-black
   * obstacles keep an edge against it — and is left a literal in lib/map/draw.ts
   * on purpose. Do not tokenize it.
   */
  elevated: number;
  /** `--signal-cmd`: a value the operator is committing. */
  cmd: number;
  /** `--signal-caution`: an assertion about the world, not a command. */
  caution: number;
  /** `--signal-live`: measured, happening now. */
  live: number;
}

export const SIGNAL: Record<ThemeMode, SignalTokens> = {
  light: {
    background: 0xe9eef2,
    elevated: 0xe2e9ee,
    cmd: 0x0a6d94,
    caution: 0x93600e,
    live: 0x12784a,
  },
  dark: {
    background: 0x0b1014,
    elevated: 0x1b252d,
    cmd: 0x45c8f0,
    caution: 0xf0b23c,
    live: 0x4fd98d,
  },
};

/** `0x2b5f77` → `"#2b5f77"`, for a 2D context or a canvas texture. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
