"use client";

import {
  Chip,
  InstrumentGroup,
  Readout,
  Segmented,
} from "@/components/console/instrument";
import type { ModeSwitch } from "@/hooks/use-mode-switch";
import type { SwitchableMode } from "@/lib/api/mapping";

const MODES: readonly { value: SwitchableMode; label: string }[] = [
  { value: "MANUAL", label: "Mapping" },
  { value: "AUTO", label: "Navigation" },
];

/**
 * Which mode is commanded, and which the robot reports — LocomotionControl's
 * two-row epistemics. A switch is acknowledged by the whole stack rebuilding,
 * leaving 10–30 s with no link; the caption says so, so a dead status strip
 * reads as expected rather than a fault.
 *
 * Presses go to `onSelect`, not the hook: the page confirms every switch and
 * knows how loud that dialog must be.
 */
export function ModeControl({
  control,
  onSelect,
}: {
  control: ModeSwitch;
  onSelect: (mode: SwitchableMode) => void;
}) {
  const { reported, stateStatus, pending, busy, error } = control;

  // MAINTENANCE (or no frame) lights no segment — lighting the nearest would
  // be a claim about the robot.
  const lit =
    pending ??
    (reported === "MANUAL" || reported === "AUTO" ? reported : null);

  return (
    <InstrumentGroup
      label="Operating mode"
      action={pending ? <Chip tone="caution">Switching</Chip> : undefined}
      caption={
        pending
          ? "The robot is restarting its software. This console loses contact for a while and reconnects on its own."
          : "Switching restarts the robot's software. This console loses contact for about 30 seconds."
      }
    >
      <div>
        <p className="instrument-label mb-1 text-muted-foreground">
          Mode · commanded
        </p>
        <Segmented
          label="Mode"
          stretch
          value={lit}
          options={MODES}
          onChange={onSelect}
          disabled={busy}
        />
      </div>

      <Readout
        label={pending ? `Reported · awaiting ${pending}` : "Reported"}
        value={reported ?? "—"}
        tone={
          pending || stateStatus === "error"
            ? "caution"
            : reported
              ? "live"
              : "neutral"
        }
      />

      {error && (
        <p className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}
    </InstrumentGroup>
  );
}
