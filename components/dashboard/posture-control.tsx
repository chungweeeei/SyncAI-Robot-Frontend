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
 * Stand up / lie down, as a one-step task each, in the manual drive panel.
 *
 * The panel is their only home: the dashboard's rail had a Posture group too,
 * and dropped it by request once the panel — which every screen can open —
 * carried the same two buttons. The sticks are why they belong here: the robot
 * has to be standing before a stick means anything. Not gated on the panel's
 * arm switch — that switch is about the sticks and the keys, and these are a
 * one-press task.
 *
 * The button that was pressed stays lit until its task is terminal, which is
 * the only feedback the operator gets that the command is still in flight: the
 * posture itself is not in any telemetry the console reads.
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
            // One posture at a time: a second command while the first is still
            // running would race the gait controller's mode change. None at
            // all under the emergency stop: standing up is moving.
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
