import { formatMetres } from "@/lib/readout";
import { cn } from "@/lib/utils";

/**
 * X, Y and Z side by side, label over value: the form every pose card over
 * the map reads in (the robot's, a stop's, a goal's), so one position reads
 * against another at a glance.
 */
export function PositionGrid({
  x,
  y,
  z,
  className,
}: {
  x: number;
  y: number;
  /** Absent when the goal went out without a height: shown as a dash, not 0. */
  z?: number;
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-3 gap-2", className)}>
      <CoordCell label="X" value={formatMetres(x)} unit="m" />
      <CoordCell label="Y" value={formatMetres(y)} unit="m" />
      <CoordCell label="Z" value={z === undefined ? "—" : formatMetres(z)} unit="m" />
    </dl>
  );
}

/** One label-over-value cell of a pose grid; muted when the value is a mask. */
export function CoordCell({
  label,
  value,
  unit,
  tone = "cmd",
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "cmd" | "live" | "muted";
}) {
  return (
    <div className="min-w-0">
      <dt className="instrument-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "readout mt-0.5 truncate text-[13px] leading-none font-medium tabular-nums",
          tone === "cmd" && "text-signal-cmd",
          tone === "live" && "text-signal-live",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">{unit}</span>
      </dd>
    </div>
  );
}

/** The header every card over the map shares: what it is about, its state, its menu. */
export const cardHeader = "flex items-center gap-2 border-b border-hairline pb-2";

const ACTION_BASE =
  "instrument-label flex h-7 items-center justify-center gap-1.5 rounded-sm border transition-colors disabled:opacity-50 pointer-coarse:h-10";

/**
 * The action row's buttons: cmd for a send, warn for a cancel, quiet for
 * the ones that only tidy the screen (Clear, Close).
 */
export function cardAction(tone: "cmd" | "warn" | "quiet") {
  return cn(
    ACTION_BASE,
    tone === "cmd" &&
      "flex-1 border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd hover:bg-signal-cmd/20",
    tone === "warn" &&
      "flex-1 border-signal-warn/50 bg-signal-warn/12 text-signal-warn hover:bg-signal-warn/20",
    tone === "quiet" &&
      "border-hairline px-2 text-muted-foreground hover:bg-elevated hover:text-foreground",
  );
}
