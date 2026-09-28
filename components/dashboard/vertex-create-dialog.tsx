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
 * One placement awaiting a name. `key` is what tells a second placement from
 * a re-aimed first one: the form is remounted per key, so the name typed for
 * one stop never carries over to the next, while Use robot position — which
 * replaces the pose under the same key — keeps it.
 */
export interface Placement {
  key: number;
  pose: PlanarPose;
}

/**
 * "Create waypoint" — the question behind a released Add waypoint drag on the
 * viewport: what is this stop called, and what is it for.
 *
 * A dialog rather than the floor plan editor's inline panel because the
 * viewport has no panel to put a form in — its read-back column is sized for a
 * chip and a sentence — and because the gesture is already over by the time
 * the question is asked. Nothing is written until Create: a placed pose that
 * is cancelled here leaves no row and no marker, which is what makes the
 * gesture safe to try.
 *
 * The pose is shown in the commanded hue, the way the goal read-back shows the
 * pose a drag produced, so the operator can check the heading they aimed
 * before naming it. It is not editable here: the map is where a pose is set,
 * and Use robot position is the one other source, for the stop you mark by
 * driving to it (same as the editor's button of that name).
 */
export function VertexCreateDialog({
  placement,
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
  // The close transition outlives the prop going null, so the last placement
  // is kept and rendered while the popup animates out — the same reason and
  // the same render-time derivation as VertexMoveDialog.
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
  robotPose,
  robotPoseReason,
  busy,
  error,
  onUseRobotPose,
  onCreate,
  onClose,
}: {
  pose: PlanarPose;
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
  // The backend's `min_length=1` would reject a blank name, but as a 422 whose
  // detail is a validation *array* rather than a sentence. Refusing here is what
  // keeps that off the operator's screen.
  const submittable = trimmed.length > 0 && !busy;

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
        {/* A list rather than the editor's segmented row: five short labels
          * fit a 240 px panel, and a dialog has room for the full names and
          * the one-line hint that says what each role is for. `items` is
          * what makes the trigger show the label rather than the enum. */}
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

      {/* Same three readouts, in the same order and the same commanded hue, as
        * the goal read-back and the move dialog: this is a pose the operator
        * produced, shown back before it is committed to. */}
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
      {/* Only while the button below is greyed: a disabled control with no
        * reason is the failure mode useRobotMapPose spends its sentences on. */}
      {!robotPose && robotPoseReason && (
        <p className="text-[11px] leading-snug text-muted-foreground">{robotPoseReason}</p>
      )}

      <AlertDialogFooter>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Between Cancel and Create, and secondary to both: it changes the
          * pose being named, it does not finish or abandon the naming. */}
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
