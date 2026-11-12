"use client";

import { ArrowLeftIcon, Trash2Icon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * The last question before something is removed for good: what goes, what
 * goes with it, Keep and the verb. An AlertDialog (no backdrop dismiss)
 * because nothing is behind the answer.
 *
 * It holds no state of its own. The caller owns `open` and the write, so a
 * refusal keeps the dialog up with the backend's sentence in it, and a
 * success closes it from the caller's own callback. While `busy` it cannot
 * be closed: the write is already on its way.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  busy = false,
  error = null,
  errorTone = "warn",
  verb = "Delete",
  busyVerb = "Deleting…",
  overlayClassName,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** The question, naming the thing: `Delete Lobby?` */
  title: React.ReactNode;
  /** The consequence the title does not state. */
  children: React.ReactNode;
  busy?: boolean;
  /** The refusal, rendered verbatim. */
  error?: string | null;
  errorTone?: "warn" | "caution";
  verb?: string;
  busyVerb?: string;
  /** For a dialog that ends what the page behind it was for. */
  overlayClassName?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <AlertDialogContent overlayClassName={overlayClassName}>
        <AlertDialogHeader>
          {/* wrap-anywhere: names have no spaces and the popup is phone-wide. */}
          <AlertDialogTitle className="wrap-anywhere">{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>

        <ErrorLine tone={errorTone}>{error}</ErrorLine>

        <AlertDialogFooter>
          {/* Icon and label, the house pattern: the last screen before a
            * removal is no place for two unlabelled buttons. */}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            <ArrowLeftIcon data-icon="inline-start" />
            Keep
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
            <Trash2Icon data-icon="inline-start" />
            {busy ? busyVerb : verb}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
