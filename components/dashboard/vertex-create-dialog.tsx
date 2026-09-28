"use client";

import * as React from "react";
import { MapPinPlusIcon } from "lucide-react";

import { Readout, Segmented } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_VERTEX_TYPE, VERTEX_TYPES } from "@/lib/map/vertex";
import type { VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

const TYPE_OPTIONS = VERTEX_TYPES.map(({ value, label }) => ({ value, label }));

/**
 * "New waypoint" — the question behind a released Add waypoint drag on the
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
 * before naming it. It is not editable here; the map is where a pose is set.
 */
export function VertexCreateDialog({
  pose,
  busy,
  error,
  onCreate,
  onClose,
}: {
  /** The placed pose being named, or null when the dialog is closed. */
  pose: PlanarPose | null;
  /** The write is in flight. */
  busy: boolean;
  /** The backend's refusal, or null. Rendered verbatim. */
  error: string | null;
  onCreate: (name: string, type: VertexType) => void;
  onClose: () => void;
}) {
  // The close transition outlives the prop going null, so the last pose is
  // kept and rendered while the popup animates out — the same reason and the
  // same render-time derivation as VertexMoveDialog.
  const [shown, setShown] = React.useState<PlanarPose | null>(pose);
  if (pose && pose !== shown) setShown(pose);

  return (
    <AlertDialog
      open={pose !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        {shown && (
          <NameForm
            // A fresh form per placement, so the second stop does not open
            // with the first one's name still in the field; re-opening the
            // same pose (an error, dismissed and retried) keeps what was typed.
            key={`${shown.x},${shown.y},${shown.theta}`}
            pose={shown}
            busy={busy}
            error={error}
            onCreate={onCreate}
            onClose={onClose}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NameForm({
  pose,
  busy,
  error,
  onCreate,
  onClose,
}: {
  pose: PlanarPose;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, type: VertexType) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<VertexType>(DEFAULT_VERTEX_TYPE);
  const nameId = React.useId();

  const trimmed = name.trim();
  // The backend's `min_length=1` would reject a blank name, but as a 422 whose
  // detail is a validation *array* rather than a sentence. Refusing here is what
  // keeps that off the operator's screen.
  const submittable = trimmed.length > 0 && !busy;
  const spec = VERTEX_TYPES.find((option) => option.value === type);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submittable) onCreate(trimmed, type);
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>New waypoint</AlertDialogTitle>
        <AlertDialogDescription>
          Name the stop you just placed. It is saved on the active map and can be
          sent to from here or used in a task.
        </AlertDialogDescription>
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
        <p className="instrument-label mb-1 text-muted-foreground">Type</p>
        <Segmented
          label="Type"
          stretch
          value={type}
          options={TYPE_OPTIONS}
          onChange={setType}
          disabled={busy}
        />
        {spec && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {spec.hint}
          </p>
        )}
      </div>

      {/* Same three readouts, in the same order and the same commanded hue, as
        * the goal read-back and the move dialog: this is a pose the operator
        * produced, shown back before it is committed to. */}
      <div className="space-y-1 rounded-md border border-hairline bg-elevated/50 p-2.5">
        <Readout label="X" value={pose.x.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Y" value={pose.y.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Heading" value={pose.theta.toFixed(1)} unit="°" tone="cmd" />
      </div>

      {error && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      <AlertDialogFooter>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!submittable}>
          <MapPinPlusIcon data-icon="inline-start" />
          Create
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
