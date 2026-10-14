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
 * Stand up / lie down, a one-step task each, in the drive panel (the robot
 * must stand before the sticks mean anything). Not gated on the arm switch,
 * which is about the sticks and keys.
 *
 * The pressed button stays lit until its task ends: the posture itself is in
 * no telemetry the console reads, so that is the only feedback.
 */
export function PanelPostureControl({
  robotId,
  className,
}: {
  robotId: string;
  className?: string;
}) {
  const posture = usePosture(robotId);
  const { sent, running, busy } = posture;
  const { engaged: stopped } = useConsoleEstop();
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="grid grid-cols-2 gap-1.5">
        {COMMANDS.map((command) => (
          <button
            key={command.posture}
            type="button"
            // One at a time, or two would race the gait mode change. None
            // under the stop: standing up is moving.
            disabled={busy || running || stopped}
            onClick={() => posture.send(command.posture)}
            className={cn(
              "instrument-label flex h-8 items-center justify-center gap-1.5 rounded-sm border px-2 transition-colors disabled:opacity-40 pointer-coarse:h-10",
              running && sent === command.posture
                ? "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
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
