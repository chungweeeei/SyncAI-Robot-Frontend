"use client";

import * as React from "react";
import { Loader2Icon, LocateFixedIcon, MapPinPlusIcon, ScanSearchIcon } from "lucide-react";

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
import type { PlacedPose, PlanarPose } from "@/lib/types/robot";

/**
 * One placement awaiting a name. The form remounts per `key`, so a typed name
 * never carries to the next stop; Use robot position and Detect charger keep
 * the key and the name.
 */
export interface Placement {
  key: number;
  /** With the ground height of the floor it was placed on. */
  pose: PlacedPose;
  /**
   * The pose is the charger's as the robot measured it. Part of the placement
   * rather than of the request, so it is gone the moment the pose is anything
   * else.
   */
  detected?: boolean;
  /**
   * Placed with Add charger: the type is Charger from the start and stays
   * so. The pose is still the press's until a source replaces it.
   */
  charger?: boolean;
}

/** Detect charger as the dialog sees it: one request, owned by the caller. */
export interface ChargerDetectControl {
  /** The robot is looking. */
  busy: boolean;
  /** The last attempt's failure, or null. Rendered verbatim. */
  error: string | null;
  onDetect: () => void;
}

/**
 * Names a waypoint after an Add waypoint drag. A dialog because the viewport
 * has no room for an inline form. Nothing is written until Create, which is
 * what makes the gesture safe to try.
 *
 * The pose is shown, not editable: the map sets it, Use robot position is one
 * other source, and for a Charger, Detect charger is the third: the robot
 * looks for the charger and the pose becomes the one it measured. Either
 * needs the robot localized on this map (`robotPose`), and only the press
 * of its button asks the robot anything. Add charger is Add waypoint with
 * the type set (`Placement.charger`).
 */
export function VertexCreateDialog({
  placement,
  lockedReason = null,
  robotPose,
  robotPoseReason,
  busy,
  error,
  chargerDetect,
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
  chargerDetect: ChargerDetectControl;
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
        // Not while the robot is looking: the answer would have no form to
        // land in, and the robot would go on looking for nobody.
        if (!open && !chargerDetect.busy) onClose();
      }}
    >
      <AlertDialogContent>
        {shown && (
          <NameForm
            key={shown.key}
            pose={shown.pose}
            detected={shown.detected ?? false}
            charger={shown.charger ?? false}
            lockedReason={lockedReason}
            robotPose={robotPose}
            robotPoseReason={robotPoseReason}
            busy={busy}
            error={error}
            chargerDetect={chargerDetect}
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
  detected,
  charger,
  lockedReason,
  robotPose,
  robotPoseReason,
  busy,
  error,
  chargerDetect,
  onUseRobotPose,
  onCreate,
  onClose,
}: {
  pose: PlacedPose;
  detected: boolean;
  charger: boolean;
  lockedReason: string | null;
  robotPose: PlanarPose | null;
  robotPoseReason: string | null;
  busy: boolean;
  error: string | null;
  chargerDetect: ChargerDetectControl;
  onUseRobotPose: () => void;
  onCreate: (name: string, type: VertexType) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<VertexType>(
    charger ? "CHARGE" : DEFAULT_VERTEX_TYPE,
  );
  const nameId = React.useId();
  const typeId = React.useId();
  const detectNoteId = React.useId();
  const detecting = chargerDetect.busy;

  const trimmed = name.trim();
  // The backend would refuse a blank name with a validation array, not a
  // sentence, so it is refused here.
  const submittable =
    trimmed.length > 0 && !busy && !detecting && lockedReason === null;
  // One line for both: each is the answer to the last thing pressed.
  const shownError = chargerDetect.error ?? error;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onCreate(trimmed, type);
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{charger ? "Add charger" : "Create waypoint"}</AlertDialogTitle>
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
          // Held while the robot looks: Detect charger belongs to the type.
          // Fixed for Add charger: it was pressed to place one.
          disabled={busy || detecting || charger}
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

      {/* Only a charger has something the robot can look for. Here, under
        * the type that offers it, rather than in the footer's row of three. */}
      {type === "CHARGE" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!robotPose || busy || detecting}
            aria-describedby={detectNoteId}
            onClick={chargerDetect.onDetect}
          >
            {detecting ? (
              <Loader2Icon
                data-icon="inline-start"
                aria-hidden
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ScanSearchIcon data-icon="inline-start" />
            )}
            Detect charger
          </Button>
          <p
            id={detectNoteId}
            aria-live="polite"
            className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground"
          >
            {detecting
              ? "Looking for the charger… up to 8 s"
              : !robotPose
                ? robotPoseReason
                : detected
                  ? "Charger found. Press again to measure it once more."
                  : "Face the robot's camera toward the charger, then press."}
          </p>
        </div>
      )}

      {/* The same readouts as the goal read-back, so the aim can be checked. */}
      <div className="space-y-1 rounded-md border border-hairline bg-elevated/50 p-2.5">
        <Readout label="X" value={pose.x.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Y" value={pose.y.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Z" value={pose.z.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Orientation" value={pose.theta.toFixed(1)} unit="°" tone="cmd" />
      </div>

      {shownError && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {shownError}
        </p>
      )}
      {lockedReason && (
        <p className="text-[11px] leading-snug text-signal-caution">{lockedReason}</p>
      )}
      {/* Says why Use robot position is greyed; Detect charger says it itself. */}
      {!robotPose && robotPoseReason && type !== "CHARGE" && (
        <p className="text-[11px] leading-snug text-muted-foreground">{robotPoseReason}</p>
      )}

      <AlertDialogFooter>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || detecting}
          onClick={onClose}
        >
          Cancel
        </Button>
        {/* Secondary: it changes the pose, it does not finish the naming. */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!robotPose || busy || detecting}
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
