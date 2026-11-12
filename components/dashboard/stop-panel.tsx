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
import { PositionGrid, cardAction, cardHeader } from "@/components/dashboard/overlay-card";
import { immediateDeleteQuestion } from "@/components/dashboard/vertex-move-dialog";
import { iconButtonClass } from "@/components/tasks/icon-button";
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
 * step into the way between the two. A stop with
 * no route offers no Go: it would fail for the same reason. While this
 * console's goal runs the panel is the one card over the map — the goal's
 * own read-back steps aside — so it carries that goal's Cancel. Where it
 * sits depends on the stop: on the stop the robot is heading to, Cancel is
 * the panel's action; on any other, a tap is as often the next stop picked
 * ahead as a change of mind, so Go stays, held until the robot gets there,
 * and Cancel waits in the ⋯ menu. Presentation only.
 */
export function StopPanel({
  vertex,
  state,
  floors,
  stale,
  running,
  goalHere,
  goalName,
  cancelable,
  onCancel,
  cancelError = null,
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
  /** The running goal is this stop: the robot is already on its way here. */
  goalHere: boolean;
  /** The waypoint the running goal is heading to, or null for a goal set on the map. */
  goalName: string | null;
  /** The running goal can be canceled now (it has an id and no request is in flight). */
  cancelable: boolean;
  onCancel: () => void;
  /** The backend's refusal of that Cancel, or null. Rendered verbatim. */
  cancelError?: string | null;
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
      <div className={cardHeader}>
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
            className={cn(iconButtonClass, "-mr-1")}
          >
            <EllipsisIcon className="size-3.5" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {running && !goalHere && (
              <>
                <DropdownMenuItem disabled={!cancelable} onClick={onCancel}>
                  <XIcon aria-hidden />
                  Cancel current goal
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem disabled={editLock !== null} onClick={() => onReplace(vertex)}>
              <MapPinIcon aria-hidden />
              Reposition
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={deleting || editLock !== null}
              onClick={() => {
                if (window.confirm(immediateDeleteQuestion(vertex.name))) {
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

      {/* Where the stop is, by request no more: the route is on the map, and
        * its heading is the arrow there. Floors stay: a route across storeys
        * is a decision. */}
      <PositionGrid x={vertex.x} y={vertex.y} z={vertex.z} className="mt-2.5" />
      {reachable && floors.length > 1 && (
        <Readout label="Floors" value={floors.join(" → ")} tone="cmd" className="mt-2.5" />
      )}

      {/* role=status so a screen reader hears the answer arrive; kept mounted
        * when empty, since a live region added with its text is not read. */}
      <div role="status" className="space-y-1.5 text-[11px] leading-snug break-words not-empty:mt-2.5">
        {running && goalHere && <p className="text-signal-cmd">The robot is on its way here.</p>}
        {running && !goalHere && (
          <p className="text-signal-caution">
            The robot is on its way to {goalName ?? "another goal"}. Go opens once it gets there.
          </p>
        )}
        {cancelError && <p className="text-signal-warn">{cancelError}</p>}
        {preview && !reachable && (
          <p className="text-signal-warn">{stepFailureText(preview.message)}</p>
        )}
        {error && <p className="text-signal-warn">{error}</p>}
        {stale && reachable && (
          <p className="text-signal-caution">The robot has moved since this route was planned.</p>
        )}
        {editLock && <p className="text-signal-caution">{editLock}</p>}
        {deleteError && (
          <p role="alert" className="text-signal-warn">
            {deleteError}
          </p>
        )}
      </div>

      {reachable && !stale && goLockReason && (
        <p className="mt-2.5 text-[11px] leading-snug text-signal-caution">{goLockReason}</p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {running && goalHere ? (
          <button
            type="button"
            disabled={!cancelable}
            onClick={onCancel}
            className={cardAction("warn")}
          >
            <XIcon className="size-3.5" aria-hidden />
            Cancel
          </button>
        ) : stale && reachable ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onAgain(vertex)}
            className={cardAction("cmd")}
          >
            <RefreshCwIcon className="size-3.5" aria-hidden />
            Preview again
          </button>
        ) : (
          <button
            type="button"
            disabled={!canGo}
            onClick={() => onGo(vertex)}
            className={cardAction("cmd")}
          >
            <SendIcon className="size-3.5" aria-hidden />
            Go
          </button>
        )}
        <button type="button" aria-label="Close" onClick={onClose} className={cardAction("quiet")}>
          <XIcon className="size-3.5" aria-hidden />
        </button>
      </div>
    </section>
  );
}
