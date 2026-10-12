"use client";

import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";

import { InstrumentGroup } from "@/components/console/instrument";
import { TaskStatusChip } from "@/components/console/task-chip";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { usePosture, type PostureControl as Posture } from "@/hooks/use-posture";
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
 * Stand up / lie down, as a one-step task each.
 *
 * These live in the rail rather than on the viewport because they are the one
 * thing the operator commands that has no position to it — putting them among
 * the map tools would imply a place on the floor they do not have.
 *
 * The button that was pressed stays lit until its task is terminal, which is
 * the only feedback the operator gets that the command is still in flight: the
 * posture itself is not in any telemetry the console reads.
 */
export function PostureControl({ robotId }: { robotId: string }) {
  const posture = usePosture(robotId);
  const { sent, taskStatus, running } = posture;

  return (
    <InstrumentGroup
      label="Posture"
      action={taskStatus ? <TaskStatusChip status={taskStatus} /> : undefined}
    >
      <PostureButtons posture={posture} />

      {sent && !running && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="instrument-label text-muted-foreground">Last</span>
          <button
            type="button"
            onClick={posture.clear}
            className="readout text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {sent === "STANDUP" ? "Stand" : "Lie down"}
            <span className="ml-1.5 text-[11px]">clear</span>
          </button>
        </div>
      )}

      <PostureError posture={posture} />
    </InstrumentGroup>
  );
}

/**
 * The two posture buttons alone, for the manual drive panel: an operator
 * driving from a screen with no rail (or from a phone, where the rail is far
 * below the viewport) still has to stand the robot up before the sticks mean
 * anything. Not gated on the panel's arm switch — that switch is about the
 * sticks and the keys, and these are a one-press task like the rail's.
 *
 * Its own usePosture, so the lit button and the error belong to the surface
 * that sent them; the backend is what serialises two consoles' commands.
 */
export function PanelPostureControl({
  robotId,
  className,
}: {
  robotId: string;
  className?: string;
}) {
  const posture = usePosture(robotId);
  return (
    <div className={cn("space-y-1.5", className)}>
      <PostureButtons posture={posture} />
      <PostureError posture={posture} />
    </div>
  );
}

function PostureButtons({ posture }: { posture: Posture }) {
  const { sent, running, busy } = posture;
  const { engaged: stopped } = useConsoleEstop();
  return (
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
  );
}

function PostureError({ posture }: { posture: Posture }) {
  if (!posture.error) return null;
  return (
    <p className="text-[11px] leading-snug break-words text-signal-warn">
      {posture.error}
    </p>
  );
}
