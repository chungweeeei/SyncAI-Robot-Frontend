/**
 * The signal hues the canvases draw with, transcribed once from
 * `app/globals.css` — a canvas cannot read a CSS variable. A token moved there
 * must be moved here too. Not read from the computed stylesheet at runtime:
 * the scene is built before paint, and a miss would be a black viewport.
 *
 * Only tokens a canvas draws with belong here.
 */

export type ThemeMode = "light" | "dark";

interface SignalTokens {
  /** `--background` */
  background: number;
  /**
   * `--elevated`. The editor's *dark* well is deliberately a lighter literal in
   * lib/map/draw.ts, so near-black obstacles keep an edge. Do not tokenize it.
   */
  elevated: number;
  /** `--signal-cmd`: a value the operator is committing. */
  cmd: number;
  /** `--signal-caution`: an assertion about the world, not a command. */
  caution: number;
  /** `--signal-live`: measured, happening now. */
  live: number;
  /** `--signal-warn`: faulted, or forbidden (forbidden zones). */
  warn: number;
}

export const SIGNAL: Record<ThemeMode, SignalTokens> = {
  light: {
    background: 0xe9eef2,
    elevated: 0xe2e9ee,
    cmd: 0x0a6d94,
    caution: 0x93600e,
    live: 0x12784a,
    warn: 0xc02f34,
  },
  dark: {
    background: 0x0b1014,
    elevated: 0x1b252d,
    cmd: 0x45c8f0,
    caution: 0xf0b23c,
    live: 0x4fd98d,
    warn: 0xf4595e,
  },
};

/** `0x2b5f77` → `"#2b5f77"`, for a 2D context or a canvas texture. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
