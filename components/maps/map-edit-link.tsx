"use client";

import Link from "next/link";
import { PencilIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

const NO_GRID_REASON =
  "This map has no floor plan to edit yet. Rebuild one from the card first.";
const CONVERTING_REASON =
  "This map is still being prepared. Wait for it to finish.";

/**
 * The corner tile, one slot in from MapDeleteControl's: `right-2` is the X's
 * 8 px inset, plus its 24 px tile, plus a 6 px gap — 38 px, which is `9.5`
 * on Tailwind's 4 px scale. Same surface and hairline as the other two tiles
 * (see MapDeleteControl for why a tile over a thumbnail carries its own),
 * copied rather than imported, which is how the activate control did it.
 */
const CORNER =
  "absolute top-2 right-9.5 z-10 flex size-6 items-center justify-center rounded-sm border border-hairline bg-panel/90 backdrop-blur-sm";

/**
 * The way into the floor plan editor, as the third corner tile.
 *
 * It used to be a word in the chip row, beside the map's facts. Moved up here
 * beside the X by request: Edit and Delete are the two things done *to* the
 * card as a whole, and reading left to right across the top edge now gives
 * the card's verbs in one place — switch (or in use), then edit, then delete
 * — while the chip row keeps the facts and Export, which takes a copy away
 * without touching anything. A pencil is as universal a glyph for "open and
 * change" as an X is for "remove", so a label would only repeat it; the name
 * survives as the tooltip and the accessible name.
 *
 * Greyed for a map with no floor plan — the editor would open onto a guard
 * screen — and mid-conversion, when the grid on disk is about to be replaced
 * and cells saved now would land on a map with different extents. A map
 * whose re-conversion *failed* keeps its editor: the grid it serves is the
 * archived one, which is a real grid and the only one it has. A look-alike
 * span rather than a disabled link, for the reason the other tiles give —
 * the tooltip is the point, and `disabled` would swallow it.
 */
export function MapEditLink({ map }: { map: MapSummary }) {
  const converting = map.grid_status === "converting";

  if (!map.grid || converting) {
    return (
      <span
        aria-disabled="true"
        title={converting ? CONVERTING_REASON : NO_GRID_REASON}
        className={cn(
          CORNER,
          "cursor-not-allowed text-muted-foreground opacity-40",
        )}
      >
        <PencilIcon className="size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <Link
      href={`/maps/${encodeURIComponent(map.name)}/edit`}
      aria-label={`Edit ${map.name}`}
      title={`Edit ${map.name}`}
      className={cn(
        CORNER,
        "text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-elevated hover:text-foreground",
      )}
    >
      <PencilIcon className="size-3.5" aria-hidden />
    </Link>
  );
}
