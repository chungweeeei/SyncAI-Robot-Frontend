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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OctomapLine } from "@/components/mapping/octomap-line";
import { MAP_NAME_RE } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

/**
 * Name and save the map the current run built — the run's only durable exit,
 * since the keyframes live in RAM. A save also ends the run.
 *
 * The robot builds the map's 3D map from the scan after every save; it takes
 * minutes, and the map cannot be used until it is done.
 *
 * A dialog, by request: the name is the one thing to think about here, and a
 * strip over a moving picture is not where to think.
 *
 * After the save it stays open as the receipt — the backend's sentence and
 * the 3D map's progress — with one Close; it is the only place that is
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
  /** The saved map's catalogue entry while its 3D map is being built. */
  conversion: MapSummary | null;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const nameId = React.useId();
  const valid = MAP_NAME_RE.test(name);

  const close = () => {
    setName("");
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
              if (valid && !busy) onSave(name);
            }}
            className="contents"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Save this map?</AlertDialogTitle>
              <AlertDialogDescription>
                The run lives in the robot&apos;s memory until saved. Saving
                ends the run and can take a minute on a large site; the robot
                then builds the map&apos;s 3D map, which takes several minutes.
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
                aria-invalid={name.length > 0 && !valid ? true : undefined}
                disabled={busy}
                className="readout h-8 rounded-sm"
              />
              {/* Shown only while the name breaks the rule, as on import and rename. */}
              {name.length > 0 && !valid && (
                <p className="text-[11px] leading-snug text-signal-caution">
                  Letters, digits, dot, dash and underscore only, up to 64
                  characters.
                </p>
              )}
            </div>

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
              * disk, the other how the 3D map went. */}
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
