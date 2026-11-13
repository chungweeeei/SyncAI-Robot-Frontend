"use client";

import * as React from "react";
import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from "lucide-react";

import { useConsoleEstop } from "@/hooks/use-console-estop";
import { usePosture } from "@/hooks/use-posture";
import { isTypingTarget } from "@/lib/keyboard";
import { POSTURE_KEYS, postureForKey } from "@/lib/teleop/posture-keys";
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
 *
 * R and F press them from the keyboard, but only while `keys` is on — the
 * panel's arm switch — for the reason the drive keys are: a window-level
 * key that is always live turns a stray keystroke into motion, and standing
 * up is motion. The buttons themselves stay unarmed.
 */
export function PanelPostureControl({
  keys = false,
  className,
}: {
  /** Listen for R / F on the window. */
  keys?: boolean;
  className?: string;
}) {
  const posture = usePosture();
  const { busy, pending, send } = posture;
  const { engaged: stopped } = useConsoleEstop();
  const live = keys && !busy && !stopped;

  React.useEffect(() => {
    if (!live) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // useJoystick's guards: chords stay the browser's, a field keeps its
      // letters, and a held key is one request. A key a dialog or a menu
      // took first is theirs.
      if (event.repeat || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const asked = postureForKey(event.code);
      if (!asked) return;
      event.preventDefault();
      void send(asked);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [live, send]);

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
            aria-keyshortcuts={keys ? POSTURE_KEYS[command.posture].label : undefined}
            onClick={() => send(command.posture)}
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
            {/* The key, as on the sticks: shown armed or not, so it can be
              * learnt before it works. */}
            <kbd
              aria-hidden
              className="ml-0.5 text-[10px] text-muted-foreground pointer-coarse:hidden"
            >
              {POSTURE_KEYS[command.posture].label}
            </kbd>
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
