"use client";

import { ZapIcon } from "lucide-react";

import { hasChargerMark, vertexGlyph } from "@/lib/map/vertex";
import type { VertexType } from "@/lib/types/map";

/**
 * A stop's type in a list row: its glyph, or for a charger the bolt its 3D
 * badge carries (lib/map/vertex.ts says why). Decorative: the row's name says
 * which stop it is.
 */
export function VertexTypeMark({ type }: { type: VertexType }) {
  return hasChargerMark(type) ? (
    <ZapIcon aria-hidden className="mx-auto size-3" />
  ) : (
    <span aria-hidden>{vertexGlyph(type)}</span>
  );
}
