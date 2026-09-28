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
 * The icon strip both map surfaces float over their canvas: the dashboard
 * viewport's two toolbars and the floor plan editor's. One vocabulary rather
 * than two look-alikes, so a pressed tool, a divider and a tooltip read the
 * same wherever an operator meets them — the way lib/map/gesture.ts already
 * makes a drag mean the same thing on both.
 *
 * Nothing here is icon-only. Each button carries its name as its accessible
 * name and in a tooltip beside what a press will do; under a finger, which
 * never hovers, the name is printed under the icon instead.
 */

export type ToolTone = "cmd" | "caution";

/**
 * What a button draws as its glyph. A lucide icon fits as it is; so does any
 * small component that takes a className — the editor's cell swatches are one.
 */
export type ToolIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/**
 * Pressed state is the tone's hue, like every armed or shown control in the
 * console: what a drag does and what is drawn are choices the operator made,
 * and have to read as choices at a glance.
 */
const PRESSED: Record<ToolTone, string> = {
  cmd: "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd",
  caution: "border-signal-caution/50 bg-signal-caution/12 text-signal-caution",
};

/** The strip itself: a named `toolbar` on the overlay panel ground. */
export function ToolStrip({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delay={200}>
      <div
        role="toolbar"
        aria-label={label}
        className={cn(overlayPanel, "flex flex-wrap items-center gap-1 p-1", className)}
      >
        {children}
      </div>
    </TooltipProvider>
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
              "pointer-coarse:h-10 pointer-coarse:w-auto pointer-coarse:min-w-10 pointer-coarse:flex-col pointer-coarse:gap-0.5 pointer-coarse:px-1",
              pressed
                ? PRESSED[tone]
                : "border-transparent text-muted-foreground hover:bg-elevated hover:text-foreground disabled:hover:bg-transparent",
            )}
          />
        }
      >
        <Icon aria-hidden className={cn("size-4", busy && "animate-pulse")} />
        {/* A finger never hovers, so it never reads the tooltip; under a
          * coarse pointer the button is 40 px tall and has room to say it. */}
        <span className="instrument-label hidden text-[9px] leading-none pointer-coarse:block">
          {label}
        </span>
      </TooltipTrigger>
      {/* Hidden under a coarse pointer: the label is already printed on the
        * button, and a tap would otherwise leave a tooltip standing over the
        * scene. */}
      <TooltipContent side="bottom" className="pointer-coarse:hidden">
        <span className="font-medium">{label}</span>
        <span className="opacity-70">— {hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}
