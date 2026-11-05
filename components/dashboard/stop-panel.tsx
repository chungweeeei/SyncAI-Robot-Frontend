"use client";

import {
  EllipsisIcon,
  MapPinIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { stepFailureText } from "@/lib/task/failure";
import type { RoutePreviewState } from "@/hooks/use-route-preview";
import type { MapVertex } from "@/lib/types/map";

/**
 * A tapped stop on the dashboard: the route the robot would take there,
 * already drawn on the map, and Go.
 *
 * A panel in the overlay column rather than a modal, because the route on
 * the map is what the operator is deciding on, and a dialog over the map
 * hid it at the moment of the decision. The route is asked for as the stop
 * is tapped — a preview moves nothing — so tap and Go is the whole of it,
 * as tap and Move was before. Reposition and Delete, used far less, sit in
 * the ⋯ menu; Delete still asks first, since a waypoint has no undo here.
 *
 * Go sends the stop, and the robot plans again as it sets off — a person can
 * step into the way between the two — which the footnote says. A stop with
 * no route offers no Go: it would fail for the same reason. Presentation only.
 */
export function StopPanel({
  vertex,
  state,
  floors,
  stale,
  running,
  goLocked,
  goLockReason = null,
  editLock = null,
  deleting,
  deleteError,
  onGo,
  onAgain,
  onReplace,
  onDelete,
  onClose,
  className,
}: {
  /** The stop tapped, or null when none is. */
  vertex: MapVertex | null;
  state: RoutePreviewState;
  /** The floors the route walks, in order; empty on one storey. */
  floors: readonly string[];
  /** The robot has walked off the route's start, so it is out of date. */
  stale: boolean;
  /** This console's goal is running: no route is asked for until it ends. */
  running: boolean;
  /** Go is held: a goal on its way, or the stop engaged. */
  goLocked: boolean;
  /** Why Go is held, when the reason is not a running goal. */
  goLockReason?: string | null;
  /** Why the stop is read-only (a job drives on its map). Greys Reposition and Delete. */
  editLock?: string | null;
  deleting: boolean;
  /** The backend's refusal of the delete, or null. Rendered verbatim. */
  deleteError: string | null;
  onGo: (vertex: MapVertex) => void;
  onAgain: (vertex: MapVertex) => void;
  onReplace: (vertex: MapVertex) => void;
  /** Already confirmed by the operator; the row goes now. */
  onDelete: (vertex: MapVertex) => void;
  onClose: () => void;
  className?: string;
}) {
  if (!vertex) return null;

  const { preview, pending, error } = state;
  const reachable = preview?.reachable === true;
  const canGo = reachable && !stale && !pending && !goLocked;

  return (
    <section
      className={cn(overlayPanel, "w-full p-2.5", className)}
      aria-label={vertex.name}
    >
      <div className="mb-2 flex items-center gap-2">
        <MapPinIcon className="size-3.5 shrink-0 text-signal-cmd" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{vertex.name}</h2>
        {pending ? (
          <Chip tone="cmd">PLANNING</Chip>
        ) : stale && reachable ? (
          <Chip tone="caution">OUT OF DATE</Chip>
        ) : preview && !reachable ? (
          <Chip tone="warn">NO ROUTE</Chip>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More for ${vertex.name}`}
            className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
          >
            <EllipsisIcon className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem disabled={editLock !== null} onClick={() => onReplace(vertex)}>
              <MapPinIcon aria-hidden />
              Reposition
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting || editLock !== null}
              onClick={() => {
                if (window.confirm(`Delete "${vertex.name}"? This cannot be undone.`)) {
                  onDelete(vertex);
                }
              }}
            >
              <Trash2Icon aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {reachable && (
        <div className="space-y-1">
          <Readout label="Route" value={preview.length_m.toFixed(1)} unit="m" tone="cmd" />
          {floors.length > 1 && (
            <Readout label="Floors" value={floors.join(" → ")} tone="cmd" />
          )}
        </div>
      )}

      {/* role=status so a screen reader hears the answer arrive. */}
      <div role="status">
        {running && (
          <p className="text-[11px] leading-snug text-signal-caution">
            A task is already running. Cancel it first — the robot takes one goal at a time.
          </p>
        )}
        {preview && !reachable && (
          <p className="text-[11px] leading-snug break-words text-signal-warn">
            {stepFailureText(preview.message)}
          </p>
        )}
        {error && (
          <p className="mt-1.5 text-[11px] leading-snug break-words text-signal-warn">{error}</p>
        )}
        {stale && reachable && (
          <p className="mt-2 text-[11px] leading-snug text-signal-caution">
            The robot has moved since this route was planned.
          </p>
        )}
        {editLock && (
          <p className="mt-1.5 text-[11px] leading-snug text-signal-caution">{editLock}</p>
        )}
        {deleteError && (
          <p role="alert" className="mt-1.5 text-[11px] leading-snug break-words text-signal-warn">
            {deleteError}
          </p>
        )}
      </div>

      {reachable && !stale && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {goLockReason ?? "The robot plans again when it sets off."}
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {stale && reachable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAgain(vertex)}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd transition-colors hover:bg-signal-cmd/20 disabled:opacity-50 pointer-coarse:h-10"
          >
            <RefreshCwIcon className="size-3.5" />
            Preview again
          </button>
        ) : (
          <button
            type="button"
            disabled={!canGo}
            onClick={() => onGo(vertex)}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd transition-colors hover:bg-signal-cmd/20 disabled:opacity-50 pointer-coarse:h-10"
          >
            <SendIcon className="size-3.5" />
            Go
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="instrument-label flex h-7 items-center rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:h-10"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      </div>
    </section>
  );
}
