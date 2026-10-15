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
