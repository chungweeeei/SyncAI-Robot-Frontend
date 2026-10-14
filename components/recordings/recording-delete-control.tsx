"use client";

import * as React from "react";
import { ArrowLeftIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteRecording } from "@/hooks/use-recorder";
import type { RecordingSummary } from "@/lib/api/recording";
import { formatSize } from "@/lib/recording/format";
import { cn } from "@/lib/utils";

const LIVE_REASON =
  "This recording is still running. Stop it first — deleting it now would lose the recording without stopping it.";

/**
 * Delete one recording, behind a confirmation — the map library's glyph and
 * dialog, since it is the same unrecoverable act. The dialog's warning is the
 * size, the reason anyone deletes one.
 *
 * The live recording can't be deleted (the backend answers 409
 * `recording_active`): removing the directory under a running writer leaves
 * it writing a file nothing can open. A refusal keeps the dialog open; on
 * success the row unmounts with the refetch.
 */
export function RecordingDeleteControl({
  recording,
}: {
  recording: RecordingSummary;
}) {
  const remove = useDeleteRecording();
  const [confirming, setConfirming] = React.useState(false);

  const busy = remove.isPending;
  const error = remove.error?.message ?? null;

  const live = recording.status === "recording";

  const submit = () => {
    if (busy) return;
    remove.mutate(recording.name, { onSuccess: () => setConfirming(false) });
  };

  const close = () => {
    setConfirming(false);
    remove.reset();
  };

  return (
    <>
      {/* A look-alike span while live: `disabled` swallows the pointer events
        * the tooltip needs. */}
      {live ? (
        <span
          aria-disabled="true"
          title={LIVE_REASON}
          className="flex size-6 shrink-0 cursor-not-allowed items-center justify-center rounded-sm text-muted-foreground opacity-40"
        >
          <XIcon className="size-3.5" aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
          aria-label={`Delete ${recording.name}`}
          title={`Delete ${recording.name}`}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors",
            "hover:bg-signal-warn/12 hover:text-signal-warn",
          )}
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* wrap-anywhere: names have no spaces and the popup is phone-wide. */}
            <AlertDialogTitle className="wrap-anywhere">
              Delete {recording.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {formatSize(recording.size_bytes)} of sensor data. The only way
              back is to drive the same route again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p role="alert" className="text-[11px] leading-tight text-signal-warn">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              <ArrowLeftIcon data-icon="inline-start" />
              Keep
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={submit}
            >
              <Trash2Icon data-icon="inline-start" />
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
