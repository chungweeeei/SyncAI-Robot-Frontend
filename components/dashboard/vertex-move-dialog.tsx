"use client";

import * as React from "react";
import { MapPinIcon, SendIcon, Trash2Icon } from "lucide-react";

import { Readout } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { MapVertex } from "@/lib/types/map";

/**
 * The dialog behind a tap on a waypoint. It is where the name shows (on the
 * map a caption per stop would be a wall of text).
 *
 * Move dispatches at once: this question is the confirmation, and asking twice
 * teaches click-through. GoalControl reports the job after. Reposition is the
 * secondary action, for a stop that turns out to be in a wall. Delete asks
 * once more, since the write goes through with no undo.
 *
 * Without `onConfirm` there is no Move: the 3D map page opens maps the robot
 * is not running on, where a goal would only be refused, and is an editor
 * rather than somewhere to send the robot from.
 */
export function VertexMoveDialog({
  vertex,
  busy = false,
  running = false,
  editLock = null,
  dispatchLock = null,
  deleting,
  deleteError,
  onConfirm,
  onReplace,
  onDelete,
  onClose,
}: {
  /** The stop being asked about, or null when the dialog is closed. */
  vertex: MapVertex | null;
  /** A submit is in flight. */
  busy?: boolean;
  /** A task is already running, so this one cannot be dispatched. */
  running?: boolean;
  /** Why the stop is read-only (a job drives on its map). Greys Reposition and Delete. */
  editLock?: string | null;
  /** Why no goal can be sent onto this map right now, or null. Greys Move. */
  dispatchLock?: string | null;
  /** The delete is in flight. */
  deleting: boolean;
  /** The backend's refusal of the delete, or null. Rendered verbatim. */
  deleteError: string | null;
  /** Send the robot there; omitted, the dialog offers no Move. */
  onConfirm?: (vertex: MapVertex) => void;
  /** Hand the stop's pose to the pointer so it can be put somewhere else. */
  onReplace: (vertex: MapVertex) => void;
  /** Already confirmed by the operator; the row goes now. */
  onDelete: (vertex: MapVertex) => void;
  onClose: () => void;
}) {
  // Keeps the last stop rendered through the close animation. Derived during
  // render, since an effect would paint one empty frame first.
  const [shown, setShown] = React.useState<MapVertex | null>(vertex);
  if (vertex && vertex !== shown) setShown(vertex);

  return (
    <AlertDialog
      open={vertex !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        {shown && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {onConfirm ? `Move to ${shown.name}` : shown.name}
              </AlertDialogTitle>
              {/* No description, by request. */}
            </AlertDialogHeader>

            {/* The same readouts as GoalControl's: the same kind of pose. */}
            <div className="space-y-1 rounded-md border border-hairline bg-elevated/50 p-2.5">
              <Readout label="X" value={shown.x.toFixed(2)} unit="m" tone="cmd" />
              <Readout label="Y" value={shown.y.toFixed(2)} unit="m" tone="cmd" />
              {/* The stored height: which floor the stop is on, and the z its
                * goal goes out with. */}
              <Readout label="Z" value={shown.z.toFixed(2)} unit="m" tone="cmd" />
              <Readout
                label="Orientation"
                value={shown.theta.toFixed(1)}
                unit="°"
                tone="cmd"
              />
            </div>

            {onConfirm && running && (
              <p className="text-[11px] leading-snug text-signal-caution">
                A task is already running. Cancel it first — the robot takes one
                goal at a time.
              </p>
            )}
            {onConfirm && !running && dispatchLock && (
              <p className="text-[11px] leading-snug text-signal-caution">
                {dispatchLock}
              </p>
            )}
            {editLock && (
              <p className="text-[11px] leading-snug text-signal-caution">
                {editLock}
              </p>
            )}
            {deleteError && (
              <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
                {deleteError}
              </p>
            )}

            <AlertDialogFooter>
              <Button
                variant="ghost"
                size="sm"
                // Live while this tab's goal is in flight; greyed only while a
                // job drives on the stop's map.
                className="mr-auto"
                disabled={editLock !== null}
                onClick={() => onReplace(shown)}
              >
                <MapPinIcon data-icon="inline-start" />
                Reposition
              </Button>
              <Button variant="outline" size="sm" disabled={deleting} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting || busy || editLock !== null}
                onClick={() => {
                  if (window.confirm(`Delete "${shown.name}"? This cannot be undone.`)) {
                    onDelete(shown);
                  }
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
              {onConfirm && (
                <Button
                  size="sm"
                  disabled={busy || running || deleting || dispatchLock !== null}
                  onClick={() => onConfirm(shown)}
                >
                  <SendIcon data-icon="inline-start" />
                  Move
                </Button>
              )}
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
