"use client";

import * as React from "react";
import { ArrowLeftIcon, CheckIcon, SaveIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConversionLine } from "@/components/mapping/conversion-line";
import { OctomapLine } from "@/components/mapping/octomap-line";
import type { SaveMapOptions } from "@/lib/api/mapping";
import { MAP_NAME_RE } from "@/lib/map/name";
import {
  DEFAULT_SAVE_OUTPUTS,
  SAVE_OUTPUTS_NEEDED,
  saveOutputsValid,
} from "@/lib/map/save-outputs";
import type { MapSummary } from "@/lib/types/map";

/**
 * Name and save the map the current run built — the run's only durable exit,
 * since the keyframes live in RAM. A save also ends the run.
 *
 * It also asks what to build from the scan — the floor plan, the 3D map or
 * both — because the 3D map costs minutes and most of the robot's memory,
 * and the choice cannot be made later: only the save's own cleaning builds
 * one.
 *
 * A dialog, by request: the name is the one thing to think about here, and a
 * strip over a moving picture is not where to think.
 *
 * After the save it stays open as the receipt — the backend's sentence and
 * the conversion's progress — with one Close; it is the only place that is
 * shown. Presentational over the page's mutation so the receipt outlives the
 * dialog. Cancel is held while saving: there is no abort, and closing would
 * lose the receipt and the leave-guard's lift.
 */
export function SaveMapDialog({
  open,
  busy,
  error,
  saved,
  conversion,
  onSave,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  /** The backend's refusal, verbatim. Shown here, never under the strip. */
  error: string | null;
  /** The backend's receipt, verbatim; non-null flips the dialog to its second face. */
  saved: string | null;
  /** The saved map's catalogue entry while its floor plan or 3D map is being built. */
  conversion: MapSummary | null;
  onSave: (name: string, outputs: SaveMapOptions) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const [outputs, setOutputs] = React.useState<SaveMapOptions>(DEFAULT_SAVE_OUTPUTS);
  const nameId = React.useId();
  const buildHintId = React.useId();
  const nameValid = MAP_NAME_RE.test(name);
  const outputsValid = saveOutputsValid(outputs);
  const valid = nameValid && outputsValid;

  const close = () => {
    setName("");
    setOutputs(DEFAULT_SAVE_OUTPUTS);
    onClose();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape lands here; nothing may close it mid-save.
        if (!next && !busy) close();
      }}
    >
      <AlertDialogContent>
        {saved === null ? (
          <form
            // A form so Enter saves; the handler repeats the button's guard.
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && !busy) onSave(name, outputs);
            }}
            className="contents"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Save this map?</AlertDialogTitle>
              <AlertDialogDescription>
                The run lives in the robot&apos;s memory until saved. Saving
                ends the run and can take a minute on a large site.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor={nameId} className="text-xs">
                Map name
              </Label>
              <Input
                id={nameId}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="site_a"
                aria-invalid={name.length > 0 && !nameValid ? true : undefined}
                disabled={busy}
                className="readout h-8 rounded-sm"
              />
              {/* Shown only while the name breaks the rule, as on import and rename. */}
              {name.length > 0 && !nameValid && (
                <p className="text-[11px] leading-snug text-signal-caution">
                  Letters, digits, dot, dash and underscore only, up to 64
                  characters.
                </p>
              )}
            </div>

            <fieldset
              className="space-y-1.5"
              disabled={busy}
              aria-describedby={outputsValid ? undefined : buildHintId}
            >
              <legend className="mb-1.5 text-xs font-medium">Build</legend>
              <BuildOption
                label="Floor plan"
                detail="Ready in under a minute."
                checked={outputs.grid}
                disabled={busy}
                onChange={(grid) => setOutputs((prev) => ({ ...prev, grid }))}
              />
              <BuildOption
                label="3D map"
                detail="Takes several minutes and more of the robot's memory."
                checked={outputs.octomap}
                disabled={busy}
                onChange={(octomap) => setOutputs((prev) => ({ ...prev, octomap }))}
              />
              {!outputsValid && (
                <p id={buildHintId} className="text-[11px] leading-snug text-signal-caution">
                  {SAVE_OUTPUTS_NEEDED}
                </p>
              )}
            </fieldset>

            {/* Name taken, nothing to save, wrong mode — the backend's sentence. */}
            {error && (
              <p role="alert" className="text-[11px] leading-tight text-signal-warn">
                {error}
              </p>
            )}

            <AlertDialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={close}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!valid || busy}>
                <SaveIcon data-icon="inline-start" />
                {busy ? "Saving…" : "Save"}
              </Button>
            </AlertDialogFooter>
          </form>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Map saved</AlertDialogTitle>
              <AlertDialogDescription>{saved}</AlertDialogDescription>
            </AlertDialogHeader>

            {/* Under the receipt, not replacing it: one says the scan is on
              * disk, the others how the floor plan and the 3D map went, each
              * silent when it was not asked for. */}
            <ConversionLine map={conversion} />
            <OctomapLine map={conversion} />

            <AlertDialogFooter>
              <Button type="button" size="sm" autoFocus onClick={close}>
                <CheckIcon data-icon="inline-start" />
                Close
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * One thing a save can build. The box sits inside its label, which is how
 * the primitive is named for a screen reader and why the whole row is the
 * target under a finger.
 */
function BuildOption({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-0.5 pointer-coarse:py-2 has-disabled:cursor-not-allowed has-disabled:opacity-60">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
        className="mt-px"
      />
      <span className="space-y-0.5">
        <span className="block text-xs leading-none">{label}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
