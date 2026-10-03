"use client";

import * as React from "react";
import { ArrowLeftIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { useRobotRestart } from "@/hooks/use-robot-restart";
import { cn } from "@/lib/utils";
import type { RobotMode } from "@/lib/types/robot";

/**
 * Why the button is greyed, in the operator's terms. Mapping is refused by the
 * robot itself, because a map not yet saved lives only in memory and a
 * restart would throw it away; saying so up front beats a press that comes
 * back with a refusal.
 */
function unavailableReason(
  mode: RobotMode | null,
  stateStatus: "loading" | "ok" | "error",
): string {
  if (stateStatus !== "ok" || mode === null) {
    return "Cannot reach the robot right now.";
  }
  if (mode === "MANUAL") {
    return "Available in Navigation. Save the map and switch modes first.";
  }
  return "Available in Navigation.";
}

/**
 * Restart the robot's software in the mode it is already in: the recovery
 * step for a robot that has stopped responding to navigation.
 *
 * In the Settings header rather than the status strip on purpose. The strip
 * is on every screen, and this is a rare, disruptive press that takes the
 * robot's navigation down for about 30 seconds — it belongs on the screen
 * where an operator changes things about the robot itself, one deliberate
 * step away. Solid red
 * because it is the one control on that screen that stops the machine's
 * software, and confirmed in a dialog for the same reason every stack
 * teardown in this console is.
 */
export function RestartControl() {
  const control = useRobotRestart();
  const { tasks } = useConsoleActiveTasks();
  const [confirming, setConfirming] = React.useState(false);
  const hintId = React.useId();

  const { reported, stateStatus, canRestart, pending, outcome, busy, error } =
    control;

  const close = () => setConfirming(false);

  const submit = async () => {
    // A refusal keeps the dialog open to show its sentence; otherwise the
    // restart is under way, and the hint below the button reports it.
    if (await control.restart()) setConfirming(false);
  };

  // Nothing to say while the button can simply be pressed: the dialog carries
  // the consequences, and a caption repeating them would crowd the header.
  // A failure is the robot's own sentence, verbatim; a success is this
  // console's words, since the robot's names its internal session. "Done"
  // alone did not read as "the robot is running again", so the sentence says
  // what the operator was waiting for, and it may claim Navigation because
  // that is what `succeeded` means: a rebuild that came up in another mode
  // is recorded as failed.
  const hint: { text: string; failed: boolean } | null = pending
    ? { text: "Restarting. This takes about 30 seconds.", failed: false }
    : outcome?.status === "failed"
      ? { text: outcome.message, failed: true }
      : !canRestart
        ? { text: unavailableReason(reported, stateStatus), failed: false }
        : outcome?.status === "succeeded"
          ? {
              text: "Restart complete. The robot is back in Navigation.",
              failed: false,
            }
          : null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        className="bg-destructive text-white hover:bg-destructive/90"
        disabled={!canRestart || pending || busy}
        aria-describedby={hint ? hintId : undefined}
        onClick={() => {
          control.reset();
          setConfirming(true);
        }}
      >
        <RotateCcwIcon data-icon="inline-start" />
        {/* One word, the same one the dialog confirms with; the heading beside
          * it already says it is the robot, and the hint below says when it
          * is under way. */}
        Restart
      </Button>
      {/* Always in the tree, so a screen reader hears the outcome land. */}
      <p
        id={hintId}
        role="status"
        className={cn(
          "max-w-56 text-right text-[11px] leading-snug",
          hint?.failed ? "text-signal-warn" : "text-muted-foreground",
        )}
      >
        {hint?.text}
      </p>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart the robot&apos;s software?</AlertDialogTitle>
            <AlertDialogDescription>
              {tasks.length > 0 &&
                "The robot is running a job, and restarting stops it. "}
              The robot stays in Navigation, and stops navigating for about 30
              seconds while its software starts again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p
              role="alert"
              className="text-[11px] leading-tight text-signal-warn"
            >
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              <ArrowLeftIcon data-icon="inline-start" />
              Keep running
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busy}
              onClick={() => void submit()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {busy ? "Restarting…" : "Restart"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
