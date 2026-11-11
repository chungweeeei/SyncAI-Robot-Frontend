// The vertex-type vocabulary, shared so the marker's glyph and the panel's
// type selector can never show different letters.

import type { VertexType } from "@/lib/types/map";

export interface VertexTypeSpec {
  value: VertexType;
  /** Panel label. Condensed caps in the UI, so short. */
  label: string;
  /**
   * One character beside the marker. Not a colour per type: signal hues mean
   * measured / commanded / fault, and a type is a role, not a state.
   */
  glyph: string;
  /** One line in the panel, so the roles are not guessed from the name. */
  hint: string;
}

/** Order is the panel's order; MOVE first because it is the default. */
export const VERTEX_TYPES: readonly VertexTypeSpec[] = [
  { value: "MOVE", label: "Move", glyph: "M", hint: "A plain navigation stop." },
  { value: "CHARGE", label: "Charger", glyph: "C", hint: "A charging dock." },
];

export const DEFAULT_VERTEX_TYPE: VertexType = "MOVE";

const GLYPHS: Record<VertexType, string> = VERTEX_TYPES.reduce(
  (all, spec) => ({ ...all, [spec.value]: spec.glyph }),
  {} as Record<VertexType, string>,
);

export function vertexGlyph(type: VertexType): string {
  // A row may hold a type since retired from the enum.
  return GLYPHS[type] ?? "?";
}

/**
 * A charger's mark is a bolt rather than its letter: beside a dozen M badges
 * a C was the same round badge in the same hue, and still not a colour of its
 * own, for the reason above. lucide's `zap`, on its 24-unit grid, so the 3D
 * badge draws the icon the lists and the Add charger button show.
 */
export const CHARGER_ICON_PATH =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

/**
 * A charger's mark in its own colours, by request: a black square, a red
 * bolt. Not the waypoint hue and not a signal one — the red is the bolt's,
 * not a fault's. CSS strings; the 3D layer converts them. Shared by the 3D
 * marks and the route map's, so the two cannot drift.
 */
export const CHARGER_MARK_FILL = "#111111";
export const CHARGER_MARK_BOLT = "#e5322d";

/** Whether a stop's mark is the charger's bolt rather than a glyph. */
export function hasChargerMark(type: VertexType): boolean {
  return type === "CHARGE";
}
