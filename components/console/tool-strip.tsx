"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The icon strip both map surfaces float over their canvas, one vocabulary so
 * a pressed tool reads the same on both.
 *
 * Each button has its name as accessible name and tooltip. A finger never
 * hovers, so under a coarse pointer the name is printed under the icon —
 * unless the strip is `compact` (see ToolStrip).
 */

export type ToolTone = "cmd" | "caution";

/** A lucide icon, or any small component taking a className (the cell swatches). */
export type ToolIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Pressed is the tone's hue: an operator choice reads as one at a glance. */
const PRESSED: Record<ToolTone, string> = {
  cmd: "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd",
  caution: "border-signal-caution/50 bg-signal-caution/12 text-signal-caution",
};

/** Whether the strip's buttons drop their printed label under a finger. */
const CompactContext = React.createContext(false);

/**
 * A named `toolbar` on the overlay ground.
 *
 * `compact` makes coarse-pointer buttons 32 px icons with no label, by
 * request, so a strip fits one phone row (labelled, the viewport's tools hid
 * a third of the scene). It gives up the 40 px target, so it is opt-in.
 */
export function ToolStrip({
  label,
  compact = false,
  className,
  children,
}: {
  label: string;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <CompactContext.Provider value={compact}>
      <TooltipProvider delay={200}>
        <div
          role="toolbar"
          aria-label={label}
          className={cn(overlayPanel, "flex flex-wrap items-center gap-1 p-1", className)}
        >
          {children}
        </div>
      </TooltipProvider>
    </CompactContext.Provider>
  );
}

/**
 * A named run of buttons, so a screen reader hears "Camera, Move, pressed"
 * rather than a bare "Move".
 */
export function ToolGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {children}
    </div>
  );
}

export function ToolDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px self-center bg-hairline" />;
}

export function ToolButton({
  label,
  hint,
  icon: Icon,
  tone = "cmd",
  pressed,
  busy = false,
  disabled = false,
  onClick,
}: {
  label: string;
  /** The tooltip's second half: what a press will do. */
  hint: string;
  icon: ToolIcon;
  tone?: ToolTone;
  /** Omitted for a one-shot action, which has no state to report. */
  pressed?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const compact = React.useContext(CompactContext);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "flex size-7 items-center justify-center rounded-sm border transition-colors disabled:opacity-40",
              compact
                ? "pointer-coarse:size-8"
                : "pointer-coarse:h-10 pointer-coarse:w-auto pointer-coarse:min-w-10 pointer-coarse:flex-col pointer-coarse:gap-0.5 pointer-coarse:px-1",
              pressed
                ? PRESSED[tone]
                : "border-transparent text-muted-foreground hover:bg-elevated hover:text-foreground disabled:hover:bg-transparent",
            )}
          />
        }
      >
        <Icon aria-hidden className={cn("size-4", busy && "animate-pulse")} />
        {/* A finger never sees the tooltip, so the name is printed. */}
        {!compact && (
          <span className="instrument-label hidden text-[9px] leading-none pointer-coarse:block">
            {label}
          </span>
        )}
      </TooltipTrigger>
      {/* Hidden under a coarse pointer, or a tap leaves it over the scene. */}
      <TooltipContent side="bottom" className="pointer-coarse:hidden">
        <span className="font-medium">{label}</span>
        <span className="opacity-70">— {hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}
