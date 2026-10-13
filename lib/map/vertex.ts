// The vertex-type vocabulary, shared so the marker's glyph and the panel's
// type selector can never show different letters.

import type { VertexType } from "@/lib/types/map";

export interface VertexTypeSpec {
  value: VertexType;
  /** Panel label. Condensed caps in the UI, so short. */
  label: string;
  /**
   * One character beside the marker. Not a colour per type: signal hues mean
   * measured / commanded / fault, and a WAITING stop must not render in
   * MAINTENANCE red.
   */
  glyph: string;
  /** One line in the panel, so the roles are not guessed from the name. */
  hint: string;
}

/** Order is the panel's order; GENERAL first because it is the default. */
export const VERTEX_TYPES: readonly VertexTypeSpec[] = [
  { value: "GENERAL", label: "Gen", glyph: "G", hint: "A plain navigation stop." },
  { value: "ARTIFACT", label: "Art", glyph: "A", hint: "An IoT / conveyor station." },
  { value: "CHARGER", label: "Chg", glyph: "C", hint: "A charging dock." },
  { value: "HOME", label: "Home", glyph: "H", hint: "The idle / park base." },
  { value: "WAITING", label: "Wait", glyph: "W", hint: "A hold spot for queueing." },
];

export const DEFAULT_VERTEX_TYPE: VertexType = "GENERAL";

const GLYPHS: Record<VertexType, string> = VERTEX_TYPES.reduce(
  (all, spec) => ({ ...all, [spec.value]: spec.glyph }),
  {} as Record<VertexType, string>,
);

export function vertexGlyph(type: VertexType): string {
  // A row may hold a type since retired from the enum.
  return GLYPHS[type] ?? "?";
}
