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
 * link down for about 30 seconds — it belongs on the screen where an operator
 * changes things about the robot itself, one deliberate step away. Solid red
 * because it is the one control on that screen that stops the machine's
 * software, and confirmed in a dialog for the same reason every stack
 * teardown in this console is.
 */
export function RestartControl() {
  const control = useRobotRestart();
  const { tasks } = useConsoleActiveTasks();
  const [confirming, setConfirming] = React.useState(false);
  const hintId = React.useId();

  const { reported, stateStatus, canRestart, pending, busy, error } = control;

  const close = () => setConfirming(false);

  const submit = async () => {
    // A refusal keeps the dialog open to show its sentence; anything else is
    // a restart under way, which the hint below the button reports.
    if (await control.restart()) setConfirming(false);
  };

  // Nothing to say while the button can simply be pressed: the dialog carries
  // the consequences, and a caption repeating them would crowd the header.
  const hint = pending
    ? "Restarting. This console reconnects on its own."
    : canRestart
      ? null
      : unavailableReason(reported, stateStatus);

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
        {/* One name throughout: the hint below is what says it is under way. */}
        Restart robot
      </Button>
      {hint && (
        <p
          id={hintId}
          className="max-w-56 text-right text-[11px] leading-snug text-muted-foreground"
        >
          {hint}
        </p>
      )}

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
              The robot stays in Navigation and this console loses contact for
              about 30 seconds while it starts again.
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
