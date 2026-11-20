"use client";

import * as React from "react";
import { ArrowLeftIcon, MapPlusIcon, XIcon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { MapPicker } from "@/components/maps/map-picker";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { useMaps } from "@/hooks/use-maps";

/**
 * Pick a saved map and keep building it — the other way a run begins, beside
 * Start mapping. The robot loads the map, finds where it stands on it, and
 * maps on in that map's own frame.
 *
 * A dialog for the reason the save is one: there is a choice to make and a
 * sentence to read (stand still, on ground the map covers), and the wait that
 * follows is over a minute with no progress to report — the robot says only
 * that it is busy — so the bar has no value. Cancel is held meanwhile: there
 * is no abort, and a closed dialog would lose the answer.
 *
 * Every map is offered. The catalogue cannot say which ones a resume can read,
 * so the robot's refusal is the rule, and it stays here beside the picker for
 * another map or another try. The loaded map is the one picked on opening:
 * the usual way here is to drive to the edge of what is mapped, switch to
 * Mapping and resume, and that is also the map the robot remembers its place
 * on.
 *
 * After it lands the dialog is the receipt — the backend's sentence, which
 * says where the robot found itself, the one check that it is the right
 * place. Presentational over the page's mutation, as the save dialog is.
 */
export function ResumeMapDialog({
  open,
  busy,
  error,
  resumed,
  onResume,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  /** The backend's refusal, verbatim. Shown here, never under the strip. */
  error: string | null;
  /** The backend's receipt, verbatim; non-null flips the dialog to its second face. */
  resumed: string | null;
  onResume: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape lands here; nothing may close it while the robot is at it.
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        {resumed === null ? (
          <ResumeForm busy={busy} error={error} onResume={onResume} onClose={onClose} />
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Mapping resumed</AlertDialogTitle>
              <AlertDialogDescription>{resumed}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" variant="ghost" size="sm" autoFocus onClick={onClose}>
                <XIcon data-icon="inline-start" />
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
 * The dialog's first face. Its own component so the catalogue is read only
 * while the dialog is open — the mapping screen otherwise fetches none — and
 * so the pick starts over on every open.
 */
function ResumeForm({
  busy,
  error,
  onResume,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onResume: (name: string) => void;
  onClose: () => void;
}) {
  const { maps, status } = useMaps();
  const [picked, setPicked] = React.useState<string | null>(null);
  // Derived, not set in an effect: the catalogue arrives after the first
  // render, and the operator's own pick outranks the default from then on.
  const name = picked ?? maps?.find((map) => map.active)?.name ?? null;

  return (
    <form
      // A form so Enter resumes; the handler repeats the button's guard.
      onSubmit={(event) => {
        event.preventDefault();
        if (name !== null && !busy) onResume(name);
      }}
      className="contents"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>Resume a saved map?</AlertDialogTitle>
        <AlertDialogDescription>
          The robot finds where it stands on the map you pick, then keeps
          building it. Keep the robot standing still, somewhere that map
          covers, until it answers — this can take over a minute.
        </AlertDialogDescription>
      </AlertDialogHeader>

      <MapPicker
        layout="stacked"
        maps={maps}
        value={name}
        disabled={busy}
        onPick={setPicked}
      />

      {maps === null && status === "error" && (
        <ErrorLine tone="caution">
          The robot&apos;s maps could not be read. Close this and try again.
        </ErrorLine>
      )}

      {busy ? (
        <Progress
          // No value: the robot reports no progress for this, only that it is busy.
          value={null}
          className="gap-x-3 gap-y-1.5"
          indicatorClassName="bg-signal-active"
        >
          <ProgressLabel className="text-[11px] leading-snug font-normal break-words text-signal-active">
            Finding the robot on {name}… Keep it still.
          </ProgressLabel>
        </Progress>
      ) : (
        <p className="text-[11px] leading-snug text-muted-foreground">
          The map you pick stays as it is: the run is saved as a new map, under
          a new name.
        </p>
      )}

      {/* Not found, a place that looks like another, a map that cannot be
        * resumed, wrong mode — the backend's sentence. */}
      {error && <ErrorLine>{error}</ErrorLine>}

      <AlertDialogFooter>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          <ArrowLeftIcon data-icon="inline-start" />
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={name === null || busy}>
          <MapPlusIcon data-icon="inline-start" />
          {busy ? "Resuming…" : "Resume mapping"}
        </Button>
      </AlertDialogFooter>
    </form>
  );
}
