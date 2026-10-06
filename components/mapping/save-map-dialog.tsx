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
import { ConversionLine } from "@/components/mapping/conversion-line";
import { MAP_NAME_RE } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

/**
 * Name and save the map the current run has built.
 *
 * This is the only durable exit for a mapping run: the mapper holds the
 * keyframes in RAM and nothing else serialises them, so until this succeeds
 * the map exists only while the mapping session does. A successful save also
 * *ends* the run (the robot goes idle and clears its "map so far"); the next
 * map starts with the strip's Start.
 *
 * A dialog rather than a name field in the strip, by request: the name is
 * the one thing the operator has to think about on this screen, and a field
 * in a strip over a moving picture is not where to think.
 *
 * Two faces. Before the save it asks for the name; after it, it **stays
 * open** and turns into the receipt — the backend's sentence verbatim (it is
 * the one that knows whether the floor plan conversion was started or has to
 * be run by hand) and the conversion's progress under it — with a single
 * Close. An operator who has just waited a minute for a save should read
 * how it went where they were looking, not hunt for it under the strip; the
 * read-back there is where the same lines go once Close is pressed.
 *
 * Presentational over the page's save mutation, because the receipt and the
 * conversion it watches have to outlive this dialog. A refusal (name taken,
 * nothing to save, the wrong mode) keeps the form face and shows the sentence
 * under the field. Cancel is held while saving: there is no abort, and
 * closing mid-save would lose the receipt and the leave-guard's lift.
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
  /** The backend's refusal, verbatim. Shown here, never in the read-back. */
  error: string | null;
  /** The backend's receipt, verbatim; non-null flips the dialog to its second face. */
  saved: string | null;
  /** The saved map's catalogue entry while its floor plan is being built. */
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
        // Escape is this path; while saving nothing may close the dialog, so
        // a stray key cannot take the receipt away.
        if (!next && !busy) close();
      }}
    >
      <AlertDialogContent>
        {saved === null ? (
          <form
            // A form so Enter in the name field saves, the way a
            // name-and-confirm row is expected to; the handler guards what
            // the button's `disabled` does.
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
                aria-invalid={name.length > 0 && !valid ? true : undefined}
                disabled={busy}
                className="readout h-8 rounded-sm"
              />
              {/* The rule, shown only while the name breaks it — the same
                * line the import and rename rows use, because it is the
                * same rule. */}
              {name.length > 0 && !valid && (
                <p className="text-[11px] leading-snug text-signal-caution">
                  Letters, digits, dot, dash and underscore only, up to 64
                  characters.
                </p>
              )}
            </div>

            {/* 409 (name taken), the mapper's "NO POSES!", the wrong-mode 502
              * — all arrive as the backend's own sentence, written to be shown. */}
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

            {/* Under the receipt, not replacing it — see RunReadback. */}
            <ConversionLine map={conversion} />

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
