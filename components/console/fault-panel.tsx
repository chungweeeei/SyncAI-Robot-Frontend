"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What a surface shows in place of itself after it threw while rendering. One
 * face for every boundary — a route's error.tsx, the root's global-error.tsx
 * and the component boundaries around the viewports and the strip's panels —
 * so an operator learns it once.
 *
 * It never shows the thrown message: a render error is an engineer's sentence
 * ("Cannot read properties of undefined"), and the console's copy names what
 * the operator sees and what to do about it. The browser console still has it.
 */
export function FaultPanel({
  title,
  detail,
  onRetry,
  compact = false,
  className,
}: {
  title: string;
  /** One line on what still works and what to do. Omitted when `compact`. */
  detail?: string;
  onRetry: () => void;
  /** The status strip's form: an icon chip that retries, no copy beside it. */
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onRetry}
        title={`${title}. Try again`}
        aria-label={`${title}. Try again`}
        className={cn(
          "inline-flex size-9 items-center justify-center rounded-sm text-signal-warn hover:bg-signal-warn/8 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
      >
        <TriangleAlert className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex h-full w-full items-center justify-center p-4",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-start gap-3 border-l-2 border-signal-warn pl-4">
        <span className="instrument-label inline-flex items-center gap-1.5 text-signal-warn">
          <TriangleAlert className="size-3.5" aria-hidden />
          {title}
        </span>
        {detail && (
          <p className="text-[13px] leading-snug text-muted-foreground">
            {detail}
          </p>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline px-3 text-[13px] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-10"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </button>
      </div>
    </div>
  );
}

/**
 * Laid over a 3D view while its GPU context is gone and the canvas is blank,
 * so a black rectangle reads as a pause rather than an empty map.
 */
export function GpuLostNotice() {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/60"
    >
      <span className="instrument-label text-signal-caution">
        Redrawing the map view…
      </span>
    </div>
  );
}
