"use client";

import * as React from "react";
import {
  CheckIcon,
  LocateFixedIcon,
  MapPinIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { PoseReadouts, Readout } from "@/components/console/instrument";
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
import { formatDegrees, formatMetres } from "@/lib/readout";
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
 * The map editor's dialog behind a tap on a waypoint. It is where the name
 * shows (on the map a caption per stop would be a wall of text). The
 * dashboard's tap opens StopPanel instead, which sends the robot; the editor
 * opens maps the robot is not running on, where a goal would only be refused.
 *
 * Reposition is the main action, for a stop that turns out to be in a wall.
 * Delete asks once more, since the write goes through with no undo; the
 * editor's 3D view, which only stages it, says so in the question.
 *
 * With `onSetPose` an Edit pose button turns the readouts into a form — X, Y
 * and the heading typed, or the robot's own position taken — for a stop that
 * has to sit on a known spot, which a tap or a drag only gets near. Asked for,
 * not open on every tap (2026-11-01, by request): a tap is mostly to read a
 * stop, and a field under the cursor invites an edit nobody meant. Only the
 * editor passes it: it stages the change for its Save, where the dashboard
 * would write the robot's row on a keystroke's typo. Z stays a readout, since
 * the ground sets it.
 */
export function VertexMoveDialog({
  vertex,
  editLock = null,
  deleting,
  deleteError,
  deleteQuestion = immediateDeleteQuestion,
  onReplace,
  onDelete,
  onSetPose,
  robotPose = null,
  robotPoseReason = null,
  onClose,
}: {
  /** The stop being asked about, or null when the dialog is closed. */
  vertex: MapVertex | null;
  /** Why the stop is read-only (a job drives on its map). Greys Reposition and Delete. */
  editLock?: string | null;
  /** The delete is in flight. */
  deleting: boolean;
  /** The backend's refusal of the delete, or null. Rendered verbatim. */
  deleteError: string | null;
  /** What Delete asks before `onDelete`; by default, that it cannot be undone. */
  deleteQuestion?: (name: string) => string;
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
  // The stop whose pose is being typed. By id, and dropped on close, so the
  // next tap opens on the readouts again.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  if (vertex === null && editingId !== null) setEditingId(null);
  const editing = onSetPose !== undefined && shown !== null && editingId === shown.id;

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
                {shown.name}
              </AlertDialogTitle>
              {/* No description, by request. */}
            </AlertDialogHeader>

            {editing ? (
              // Remounted per stop and per edit, so the fields start from its pose.
              <PoseForm
                key={`${shown.id}:${shown.x}:${shown.y}:${shown.theta}`}
                vertex={shown}
                disabled={editLock !== null}
                robotPose={robotPose}
                robotPoseReason={robotPoseReason}
                onApply={(pose) => onSetPose?.(shown, pose)}
              />
            ) : (
              // The same readouts as GoalControl's: the same kind of pose.
              <div className="space-y-1 rounded-md border border-hairline bg-elevated/50 p-2.5">
                <PoseReadouts pose={shown} tone="cmd" />
              </div>
            )}

            {editLock && (
              <p className="text-[11px] leading-snug text-signal-caution">
                {editLock}
              </p>
            )}
            {deleteError && (
              <ErrorLine>
                {deleteError}
              </ErrorLine>
            )}

            {/* Wraps: four buttons are wider than a phone. */}
            <AlertDialogFooter className="flex-wrap">
              <div className="mr-auto flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  // Live while this tab's goal is in flight; greyed only while a
                  // job drives on the stop's map.
                  disabled={editLock !== null}
                  onClick={() => onReplace(shown)}
                >
                  <MapPinIcon data-icon="inline-start" />
                  Reposition
                </Button>
                {onSetPose && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-pressed={editing}
                    disabled={editLock !== null}
                    onClick={() => setEditingId(editing ? null : shown.id)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    Edit pose
                  </Button>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={deleting} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting || editLock !== null}
                onClick={() => {
                  if (window.confirm(deleteQuestion(shown.name))) {
                    onDelete(shown);
                  }
                }}
              >
                <Trash2Icon data-icon="inline-start" />
                Delete
              </Button>
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
    setX(formatMetres(robotPose.x));
    setY(formatMetres(robotPose.y));
    setTheta(formatDegrees(robotPose.theta));
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
        className="readout h-7 min-w-0 flex-1 rounded-sm text-[13px]"
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
        <Readout label="Z" value={formatMetres(vertex.z)} unit="m" tone="cmd" />
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

/** What a delete that is written at once asks: the dashboard's, here and on the stop's panel. */
export function immediateDeleteQuestion(name: string): string {
  return `Delete "${name}"? This cannot be undone.`;
}
