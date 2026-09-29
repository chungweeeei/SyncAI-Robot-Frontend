"use client";

import * as React from "react";
import { ArrowLeftIcon, CpuIcon, RotateCcwIcon } from "lucide-react";

import { Chip, Readout } from "@/components/console/instrument";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { useRobotRestart } from "@/hooks/use-robot-restart";
import type { RobotMode } from "@/lib/types/robot";

/** The words the mode switch and the status strip use for the same modes. */
const MODE_LABEL: Record<RobotMode, string> = {
  AUTO: "Navigation",
  MANUAL: "Mapping",
  MAINTENANCE: "Maintenance",
};

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
    return "This console cannot reach the robot right now, so it cannot ask it to restart.";
  }
  if (mode === "MANUAL") {
    return "Restart is available in Navigation. A map that is not saved yet would be lost, so save it and switch modes first.";
  }
  return "Restart is available in Navigation.";
}

/**
 * Restart the robot's software in the mode it is already in: the recovery
 * step for a robot that has stopped responding to navigation.
 *
 * On Settings rather than in the status strip on purpose. The strip is on
 * every screen, and this is a rare, disruptive press that takes the link down
 * for about 30 seconds — it belongs beside the other things an operator
 * changes about the robot itself, one deliberate step away. Confirmed in a
 * dialog for the same reason every stack teardown in this console is.
 */
export function SystemSettings() {
  const control = useRobotRestart();
  const { tasks } = useConsoleActiveTasks();
  const [confirming, setConfirming] = React.useState(false);
  const titleId = React.useId();

  const { reported, stateStatus, canRestart, pending, busy, error } = control;

  const close = () => setConfirming(false);

  const submit = async () => {
    // A refusal keeps the dialog open to show its sentence; anything else is
    // a restart under way, which the card reports from here on.
    if (await control.restart()) setConfirming(false);
  };

  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2">
          <CpuIcon className="size-4 text-muted-foreground" />
          System
          {pending && <Chip tone="caution">Restarting</Chip>}
        </CardTitle>
        <CardDescription>
          Restart the robot&apos;s software if it stops responding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Readout
          label="Mode"
          value={reported ? MODE_LABEL[reported] : "—"}
          tone={
            pending || stateStatus === "error"
              ? "caution"
              : reported
                ? "live"
                : "neutral"
          }
        />

        <div className="flex items-center justify-between gap-4">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {pending
              ? "The robot is restarting its software. This console loses contact for a while and reconnects on its own."
              : canRestart
                ? "Restarting stops the robot's software and starts it again in the same mode. This console loses contact for about 30 seconds."
                : unavailableReason(reported, stateStatus)}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!canRestart || pending || busy}
            onClick={() => {
              control.reset();
              setConfirming(true);
            }}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Restart
          </Button>
        </div>
      </CardContent>

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
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void submit()}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {busy ? "Restarting…" : "Restart"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
