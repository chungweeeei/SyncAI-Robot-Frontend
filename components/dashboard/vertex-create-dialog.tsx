"use client";

import * as React from "react";
import { LocateFixedIcon, MapPinPlusIcon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_VERTEX_TYPE, VERTEX_TYPES } from "@/lib/map/vertex";
import type { VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * One placement awaiting a name. The form remounts per `key`, so a typed name
 * never carries to the next stop; Use robot position keeps the key and the name.
 */
export interface Placement {
  key: number;
  pose: PlanarPose;
}

/**
 * Names a waypoint after an Add waypoint drag. A dialog because the viewport
 * has no room for an inline form. Nothing is written until Create, which is
 * what makes the gesture safe to try.
 *
 * The pose is shown, not editable: the map sets it, and Use robot position is
 * the one other source.
 */
export function VertexCreateDialog({
  placement,
  lockedReason = null,
  robotPose,
  robotPoseReason,
  busy,
  error,
  onUseRobotPose,
  onCreate,
  onClose,
}: {
  /** The placed pose being named, or null when the dialog is closed. */
  placement: Placement | null;
  /** Why the map is read-only right now. Greys Create; the typed name survives. */
  lockedReason?: string | null;
  /** Where the robot stands on the active map, or null when that is unknown. */
  robotPose: PlanarPose | null;
  /** Why `robotPose` is null, for the operator. Null when it is set. */
  robotPoseReason: string | null;
  /** The write is in flight. */
  busy: boolean;
  /** The backend's refusal, or null. Rendered verbatim. */
  error: string | null;
  onUseRobotPose: () => void;
  onCreate: (name: string, type: VertexType) => void;
  onClose: () => void;
}) {
  // Kept through the close animation, as in VertexMoveDialog.
  const [shown, setShown] = React.useState<Placement | null>(placement);
  if (placement && placement !== shown) setShown(placement);

  return (
    <AlertDialog
      open={placement !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        {shown && (
          <NameForm
            key={shown.key}
            pose={shown.pose}
            lockedReason={lockedReason}
            robotPose={robotPose}
            robotPoseReason={robotPoseReason}
            busy={busy}
            error={error}
            onUseRobotPose={onUseRobotPose}
            onCreate={onCreate}
            onClose={onClose}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

const TYPE_ITEMS = VERTEX_TYPES.map(({ value, label }) => ({ value, label }));

function NameForm({
  pose,
  lockedReason,
  robotPose,
  robotPoseReason,
  busy,
  error,
  onUseRobotPose,
  onCreate,
  onClose,
}: {
  pose: PlanarPose;
  lockedReason: string | null;
  robotPose: PlanarPose | null;
  robotPoseReason: string | null;
  busy: boolean;
  error: string | null;
  onUseRobotPose: () => void;
  onCreate: (name: string, type: VertexType) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<VertexType>(DEFAULT_VERTEX_TYPE);
  const nameId = React.useId();
  const typeId = React.useId();

  const trimmed = name.trim();
  // The backend would refuse a blank name with a validation array, not a
  // sentence, so it is refused here.
  const submittable = trimmed.length > 0 && !busy && lockedReason === null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onCreate(trimmed, type);
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>Create waypoint</AlertDialogTitle>
      </AlertDialogHeader>

      <div>
        <label
          htmlFor={nameId}
          className="instrument-label mb-1 block text-muted-foreground"
        >
          Name
        </label>
        <Input
          id={nameId}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="dock-a"
          disabled={busy}
        />
      </div>

      <div>
        <p id={typeId} className="instrument-label mb-1 text-muted-foreground">
          Type
        </p>
        {/* A list, unlike the editor's segmented row, since a dialog has room
          * for each type's hint. `items` makes the trigger show the label. */}
        <Select
          items={TYPE_ITEMS}
          value={type}
          disabled={busy}
          onValueChange={(next) => {
            if (next) setType(next);
          }}
        >
          <SelectTrigger aria-labelledby={typeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VERTEX_TYPES.map((spec) => (
              <SelectItem key={spec.value} value={spec.value}>
                <span className="flex items-baseline gap-2">
                  {spec.label}
                  <span className="text-xs text-muted-foreground">{spec.hint}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* The same readouts as the goal read-back, so the aim can be checked. */}
      <div className="space-y-1 rounded-md border border-hairline bg-elevated/50 p-2.5">
        <Readout label="X" value={pose.x.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Y" value={pose.y.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Orientation" value={pose.theta.toFixed(1)} unit="°" tone="cmd" />
      </div>

      {error && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}
      {lockedReason && (
        <p className="text-[11px] leading-snug text-signal-caution">{lockedReason}</p>
      )}
      {/* Says why Use robot position is greyed. */}
      {!robotPose && robotPoseReason && (
        <p className="text-[11px] leading-snug text-muted-foreground">{robotPoseReason}</p>
      )}

      <AlertDialogFooter>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Secondary: it changes the pose, it does not finish the naming. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!robotPose || busy}
          onClick={onUseRobotPose}
        >
          <LocateFixedIcon data-icon="inline-start" />
          Use robot position
        </Button>
        <Button type="submit" size="sm" disabled={!submittable}>
          <MapPinPlusIcon data-icon="inline-start" />
          Create
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
