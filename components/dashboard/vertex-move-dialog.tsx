"use client";

import * as React from "react";
import { CheckIcon, LocateFixedIcon, MapPinIcon, SendIcon, Trash2Icon } from "lucide-react";

import { Readout } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeTheta } from "@/lib/angle";
import type { MapVertex } from "@/lib/types/map";
import type { PlacedPose, PlanarPose } from "@/lib/types/robot";

/**
 * A pose typed into the dialog. `robotZ` is the robot's body height when the
 * numbers are still the ones Use robot position took, so the caller can put
 * the stop on the robot's floor; any edit after that clears it.
 */
export interface TypedPose extends PlanarPose {
  robotZ: number | null;
}

/**
 * The dialog behind a tap on a waypoint. It is where the name shows (on the
 * map a caption per stop would be a wall of text).
 *
 * Move dispatches at once: this question is the confirmation, and asking twice
 * teaches click-through. GoalControl reports the job after. Reposition is the
 * secondary action, for a stop that turns out to be in a wall. Delete asks
 * once more, since the write goes through with no undo; the editor's 3D
 * view, which only stages it, says so in the question.
 *
 * Without `onConfirm` there is no Move: the editor's 3D view opens maps the robot
 * is not running on, where a goal would only be refused, and is an editor
 * rather than somewhere to send the robot from.
 *
 * With `onSetPose` the pose is a form — X, Y and the heading typed, or the
 * robot's own position taken — for a stop that has to sit on a known spot,
 * which a tap or a drag only gets near. Only the editor passes it: it stages
 * the change for its Save, where the dashboard would write the robot's row on
 * a keystroke's typo. Z stays a readout, since the ground sets it.
 */
export function VertexMoveDialog({
  vertex,
  busy = false,
  running = false,
  editLock = null,
  deleting,
  deleteError,
  deleteQuestion = immediateDeleteQuestion,
  onConfirm,
  onReplace,
  onDelete,
  onSetPose,
  robotPose = null,
  robotPoseReason = null,
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
  /** The delete is in flight. */
  deleting: boolean;
  /** The backend's refusal of the delete, or null. Rendered verbatim. */
  deleteError: string | null;
  /** What Delete asks before `onDelete`; by default, that it cannot be undone. */
  deleteQuestion?: (name: string) => string;
  /** Send the robot there; omitted, the dialog offers no Move. */
  onConfirm?: (vertex: MapVertex) => void;
  /** Hand the stop's pose to the pointer so it can be put somewhere else. */
  onReplace: (vertex: MapVertex) => void;
  /** Already confirmed by the operator; the row goes now. */
  onDelete: (vertex: MapVertex) => void;
  /** Take a typed pose for the stop; omitted, the pose is read-only. */
  onSetPose?: (vertex: MapVertex, pose: TypedPose) => void;
  /** Where the robot stands on this map, for Use robot position, or null. */
  robotPose?: PlacedPose | null;
  /** Why `robotPose` is null, for the operator. */
  robotPoseReason?: string | null;
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

            {onSetPose ? (
              // Remounted per stop and per edit, so the fields start from its pose.
              <PoseForm
                key={`${shown.id}:${shown.x}:${shown.y}:${shown.theta}`}
                vertex={shown}
                disabled={editLock !== null}
                robotPose={robotPose}
                robotPoseReason={robotPoseReason}
                onApply={(pose) => onSetPose(shown, pose)}
              />
            ) : (
              // The same readouts as GoalControl's: the same kind of pose.
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
            )}

            {onConfirm && running && (
              <p className="text-[11px] leading-snug text-signal-caution">
                A task is already running. Cancel it first — the robot takes one
                goal at a time.
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
                  if (window.confirm(deleteQuestion(shown.name))) {
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
                  disabled={busy || running || deleting}
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

/**
 * A typed number, or null while it is not one yet. Blank is not 0: an
 * emptied field would otherwise send the stop to the origin.
 */
function parseMetres(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function PoseForm({
  vertex,
  disabled,
  robotPose,
  robotPoseReason,
  onApply,
}: {
  vertex: MapVertex;
  disabled: boolean;
  robotPose: PlacedPose | null;
  robotPoseReason: string | null;
  onApply: (pose: TypedPose) => void;
}) {
  // Strings, not numbers: "-" and "1." are halfway typed, not wrong.
  const [x, setX] = React.useState(String(vertex.x));
  const [y, setY] = React.useState(String(vertex.y));
  const [theta, setTheta] = React.useState(String(vertex.theta));
  const [robotZ, setRobotZ] = React.useState<number | null>(null);
  const xId = React.useId();
  const yId = React.useId();
  const thetaId = React.useId();

  const px = parseMetres(x);
  const py = parseMetres(y);
  const pt = parseMetres(theta);
  const complete = px !== null && py !== null && pt !== null;
  const changed =
    complete &&
    (px !== vertex.x ||
      py !== vertex.y ||
      normalizeTheta(pt) !== normalizeTheta(vertex.theta) ||
      robotZ !== null);
  const applicable = changed && !disabled;

  // A typed number is no longer the robot's position.
  const edit = (set: (text: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    setRobotZ(null);
  };

  // A snapshot, as the create dialog takes it: a pose that crept while the
  // dialog was open would be a spot nobody chose.
  const takeRobotPose = () => {
    if (!robotPose) return;
    setX(robotPose.x.toFixed(2));
    setY(robotPose.y.toFixed(2));
    setTheta(robotPose.theta.toFixed(1));
    setRobotZ(robotPose.z);
  };

  const field = (
    id: string,
    label: string,
    unit: string,
    value: string,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void,
  ) => (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="instrument-label w-24 shrink-0 text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        // Not type="number": it reports "" for "1." and "-", erasing what is
        // halfway typed.
        inputMode="decimal"
        onChange={onChange}
        aria-invalid={parseMetres(value) === null || undefined}
        className="readout h-7 min-w-0 flex-1 rounded-sm md:text-[13px]"
      />
      <span aria-hidden className="w-3 text-[11px] text-muted-foreground">
        {unit}
      </span>
    </div>
  );

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!applicable || px === null || py === null || pt === null) return;
        // What the fields show, so a robot pose taken as 1.2499 is the 1.25
        // the operator read before applying it.
        onApply({ x: px, y: py, theta: normalizeTheta(pt), robotZ });
      }}
    >
      <div className="space-y-1.5 rounded-md border border-hairline bg-elevated/50 p-2.5">
        {field(xId, "X", "m", x, edit(setX))}
        {field(yId, "Y", "m", y, edit(setY))}
        {field(thetaId, "Orientation", "°", theta, edit(setTheta))}
        {/* Not typed: the ground under the stop sets it, on Apply. */}
        <Readout label="Z" value={vertex.z.toFixed(2)} unit="m" tone="cmd" />
      </div>
      {!robotPose && robotPoseReason && (
        <p className="text-[11px] leading-snug text-muted-foreground">{robotPoseReason}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!robotPose || disabled}
          onClick={takeRobotPose}
        >
          <LocateFixedIcon data-icon="inline-start" />
          Use robot position
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={!applicable}>
          <CheckIcon data-icon="inline-start" />
          Apply
        </Button>
      </div>
    </form>
  );
}

function immediateDeleteQuestion(name: string): string {
  return `Delete "${name}"? This cannot be undone.`;
}
