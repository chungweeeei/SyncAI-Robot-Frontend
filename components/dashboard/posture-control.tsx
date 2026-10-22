"use client";

import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";

import { useConsoleEstop } from "@/hooks/use-console-estop";
import { usePosture } from "@/hooks/use-posture";
import { cn } from "@/lib/utils";
import type { Posture as PostureCommand } from "@/lib/api/task";

const COMMANDS: ReadonlyArray<{
  posture: PostureCommand;
  label: string;
  icon: typeof ArrowUpFromLineIcon;
}> = [
  { posture: "STANDUP", label: "Stand", icon: ArrowUpFromLineIcon },
  { posture: "LIEDOWN", label: "Lie down", icon: ArrowDownToLineIcon },
];

/**
 * Stand up / lie down, motion keys sent straight to the driver, in the drive
 * panel (the robot must stand before the sticks mean anything). Not gated on
 * the arm switch, which is about the sticks and keys, nor on running jobs;
 * greyed only under the stop.
 *
 * The lit button is the reported posture; a press the robot has not reached
 * yet is lit faintly until a robot-state frame confirms it.
 */
export function PanelPostureControl({ className }: { className?: string }) {
  const posture = usePosture();
  const { busy, pending } = posture;
  const { engaged: stopped } = useConsoleEstop();
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="grid grid-cols-2 gap-1.5">
        {COMMANDS.map((command) => (
          <button
            key={command.posture}
            type="button"
            // One request at a time; a pending one does not lock, so the
            // opposite posture is always the way back. None under the stop:
            // standing up is moving.
            disabled={busy || stopped}
            onClick={() => posture.send(command.posture)}
            className={cn(
              "instrument-label flex h-8 items-center justify-center gap-1.5 rounded-sm border px-2 transition-colors disabled:opacity-40 pointer-coarse:h-10",
              posture.posture === command.posture
                ? pending === command.posture
                  ? "border-signal-cmd/30 bg-signal-cmd/6 text-signal-cmd/80"
                  : "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
                : "border-hairline hover:bg-elevated",
            )}
          >
            <command.icon className="size-3.5 shrink-0" />
            {command.label}
          </button>
        ))}
      </div>
      {posture.error && (
        <p className="text-[11px] leading-snug break-words text-signal-warn">
          {posture.error}
        </p>
      )}
    </div>
  );
}
