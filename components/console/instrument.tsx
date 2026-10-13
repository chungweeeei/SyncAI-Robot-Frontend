import * as React from "react";

import { SIGNAL_BARS } from "@/lib/robot/levels";
import type { Tone } from "@/lib/types/tone";
import { cn } from "@/lib/utils";

export type { Tone } from "@/lib/types/tone";
export { rssiToBars } from "@/lib/robot/levels";

/**
 * The console's instrument parts. Not shadcn Cards: card chrome around four
 * numbers spends most of the pixels on the frame. A group is a caps label, a
 * hairline and rows.
 *
 * `tone` is the EFIS colour semantic from globals.css: pick it by what the
 * value *is* (measured / commanded / degraded / faulted), not by look.
 */

/** Text colour per tone, for surfaces that colour a value themselves. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  live: "text-signal-live",
  cmd: "text-signal-cmd",
  active: "text-signal-active",
  caution: "text-signal-caution",
  warn: "text-signal-warn",
};

const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  live: "bg-signal-live",
  cmd: "bg-signal-cmd",
  active: "bg-signal-active",
  caution: "bg-signal-caution",
  warn: "bg-signal-warn",
};

const TONE_CHIP: Record<Tone, string> = {
  neutral: "border-hairline text-muted-foreground",
  live: "border-signal-live/40 text-signal-live bg-signal-live/8",
  cmd: "border-signal-cmd/40 text-signal-cmd bg-signal-cmd/8",
  active: "border-signal-active/40 text-signal-active bg-signal-active/8",
  caution: "border-signal-caution/40 text-signal-caution bg-signal-caution/8",
  warn: "border-signal-warn/40 text-signal-warn bg-signal-warn/8",
};

export function InstrumentGroup({
  label,
  caption,
  action,
  className,
  children,
}: {
  label: string;
  /** One muted line under the rows — use it to say where a number came from. */
  caption?: string;
  /** Controls that belong to the group, right-aligned on the label row. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("border-b border-hairline px-4 py-3.5 last:border-b-0", className)}
    >
      <header className="mb-2.5 flex h-4 items-center justify-between gap-2">
        <h2 className="instrument-label text-muted-foreground">{label}</h2>
        {action}
      </header>
      <div className="space-y-1.5">{children}</div>
      {caption && (
        <p className="mt-2.5 text-[11px] leading-tight text-muted-foreground">
          {caption}
        </p>
      )}
    </section>
  );
}

export function Readout({
  label,
  value,
  unit,
  tone = "neutral",
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", className)}>
      <span className="instrument-label shrink-0 text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "readout min-w-0 truncate text-[13px] font-medium",
          TONE_TEXT[tone],
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-[11px] font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

/** The one big number in a group. Used for the pose the operator actually reads. */
export function PrimaryReadout({
  label,
  value,
  unit,
  tone = "live",
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
}) {
  return (
    <div>
      <span className="instrument-label text-muted-foreground">{label}</span>
      <p
        className={cn(
          "readout mt-0.5 text-2xl leading-none font-medium",
          TONE_TEXT[tone],
        )}
      >
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </p>
    </div>
  );
}

export function Chip({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: Tone;
  /** Hover text, for a chip whose two words stand in for a longer fact. */
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        // A chip wrapped onto two lines reads as two facts.
        "instrument-label inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 whitespace-nowrap",
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Four-bar RSSI meter. Bars, not a number, is how signal strength is read. */
export function SignalBars({
  bars,
  tone = "live",
  className,
}: {
  bars: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn("flex items-end gap-[2px]", className)}
      aria-label={`Signal ${bars} of ${SIGNAL_BARS}`}
    >
      {/* The count is lib/robot/levels.ts's, because rssiToBars' cut-offs are
        * only right against that many bars. */}
      {Array.from({ length: SIGNAL_BARS }, (_, index) => index + 1).map((level) => (
        <span
          key={level}
          className={cn(
            "w-[3px] rounded-[1px]",
            level <= bars ? TONE_FILL[tone] : "bg-hairline",
          )}
          style={{ height: `${3 + level * 2.5}px` }}
        />
      ))}
    </span>
  );
}

/**
 * Segmented level meter (battery). Cells rather than a smooth fill, which
 * would suggest a precision the integer percentage does not have.
 */
export function SegmentMeter({
  value,
  segments = 5,
  tone = "live",
  className,
}: {
  /** 0–100. */
  value: number;
  segments?: number;
  tone?: Tone;
  className?: string;
}) {
  const filled = Math.round((Math.min(Math.max(value, 0), 100) / 100) * segments);

  return (
    <span
      className={cn("flex items-center gap-[2px]", className)}
      aria-label={`${Math.round(value)} percent`}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-3 w-[5px] rounded-[1px]",
            i < filled ? TONE_FILL[tone] : "bg-hairline",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The record indicator: a dot that pulses while a capture runs, so "still
 * running?" is answered from across a room. Reduced motion keeps the dot.
 *
 * Warn red despite `signal-warn` meaning faulted elsewhere: record-red is the
 * stronger convention here.
 */
export function RecordDot() {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="absolute inline-flex size-full animate-ping rounded-full bg-signal-warn opacity-60 motion-reduce:hidden"
      />
      <span className="relative inline-flex size-2.5 rounded-full bg-signal-warn" />
    </span>
  );
}

/**
 * Segmented selector. Commanded hue on the active segment: the operator set
 * it. `label` is required, because otherwise a screen reader hears "Move,
 * button, pressed" with nothing saying what Move is a choice of.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  stretch = false,
  disabled = false,
  className,
}: {
  /** The group's accessible name; match the visible label beside it. */
  label: string;
  /**
   * `null` lights no segment, for a value none of the options represents (the
   * robot can report a policy the console does not offer). Lighting the
   * nearest option would be a claim about the robot.
   */
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Split the container into equal segments, so long labels cannot overflow it. */
  stretch?: boolean;
  /** Dim the whole control and refuse every segment. */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "overflow-hidden rounded-sm border border-hairline",
        stretch ? "flex w-full" : "inline-flex",
        disabled && "opacity-40",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "instrument-label h-6 px-2 transition-colors pointer-coarse:min-h-10",
              "border-l border-hairline first:border-l-0",
              // The container carries the dimming; two opacities would be muddy.
              disabled && "hover:bg-transparent hover:text-muted-foreground",
              // Shrink and truncate; px-1 since flex-1 already spaces them.
              stretch && "min-w-0 flex-1 truncate px-1",
              active
                ? "bg-signal-cmd/12 text-signal-cmd"
                : "text-muted-foreground hover:bg-elevated hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Chrome for controls floating over the viewport, which can be any colour —
 * the console's only blur.
 */
export const overlayPanel =
  "rounded-sm border border-hairline bg-panel/85 shadow-sm backdrop-blur-sm";

/** Vertical hairline between strip sections. */
export function StripDivider({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("h-5 w-px shrink-0 bg-hairline", className)}
    />
  );
}
