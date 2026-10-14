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
 * Why the button is greyed. The robot refuses a restart while Mapping (an
 * unsaved map lives only in memory), so say so up front. An unreachable robot
 * gets no sentence, by request: the status strip already reads "No signal".
 */
function unavailableReason(
  mode: RobotMode | null,
  stateStatus: "loading" | "ok" | "error",
): string | null {
  if (stateStatus !== "ok" || mode === null) return null;
  if (mode === "MANUAL") {
    return "Available in Navigation. Save the map and switch modes first.";
  }
  return "Available in Navigation.";
}

/**
 * Restart the robot's software in its current mode: the recovery step for a
 * robot that has stopped responding to navigation.
 *
 * Lives on Settings rather than the status strip because it is rare and takes
 * navigation down for ~30 s; solid red and confirmed in a dialog because it
 * stops the machine's software.
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
    // A refusal keeps the dialog open to show its sentence.
    if (await control.restart()) setConfirming(false);
  };

  // Nothing to say while the button can simply be pressed — the dialog carries
  // the consequences. A failure is the robot's sentence; a success is ours,
  // since the robot's names its internal session. It may claim Navigation
  // because a rebuild that came up in another mode is recorded as failed.
  const unavailable = unavailableReason(reported, stateStatus);
  const hint: { text: string; failed: boolean } | null = pending
    ? { text: "Restarting. This takes about 30 seconds.", failed: false }
    : outcome?.status === "failed"
      ? { text: outcome.message, failed: true }
      : !canRestart
        ? unavailable ? { text: unavailable, failed: false } : null
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
