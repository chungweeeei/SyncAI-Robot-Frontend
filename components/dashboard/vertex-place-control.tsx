"use client";

import { Loader2Icon, MapPinIcon, XIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import { vertexGlyph } from "@/lib/map/vertex";
import type { MapVertex } from "@/lib/types/map";

/**
 * The re-place flow's only chrome: which stop is in hand, and a way out.
 * Without it, arming looks like a stop vanished. Presentation only; the write
 * lives in useActiveMapVertices.
 */
export function VertexPlaceControl({
  vertex,
  busy,
  error,
  onCancel,
  onDismissError,
  className,
}: {
  /** The stop being re-placed, or null when nothing is armed. */
  vertex: MapVertex | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDismissError: () => void;
  className?: string;
}) {
  // At rest it draws nothing, rather than an empty panel over the map.
  if (!vertex && !error && !busy) return null;

  return (
    <div className={cn(overlayPanel, "w-full p-2.5", className)}>
      {vertex && (
        <>
          <div className="flex items-center gap-1.5">
            <MapPinIcon aria-hidden className="size-3.5 text-signal-cmd" />
            <span className="instrument-label truncate text-signal-cmd">
              {vertexGlyph(vertex.type)} · {vertex.name}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Press on the map to set the position, drag to aim it, release to
            save.
          </p>
        </>
      )}

      {busy && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2Icon
            aria-hidden
            className="size-3 animate-spin motion-reduce:animate-none"
          />
          Saving the new position…
        </p>
      )}

      {error && (
        <p className="mt-1.5 text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      {/* An armed re-place can be abandoned; a failed one only acknowledged. */}
      {vertex ? (
        <button
          type="button"
          onClick={onCancel}
          className="instrument-label mt-2.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          <XIcon className="size-3.5" />
          Cancel
        </button>
      ) : (
        error && (
          <button
            type="button"
            onClick={onDismissError}
            className="instrument-label mt-2.5 flex h-7 w-full items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
          >
            Dismiss
          </button>
        )
      )}
    </div>
  );
}
