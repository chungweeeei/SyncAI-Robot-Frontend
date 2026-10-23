"use client";

import type * as React from "react";
import { unstable_catchError, type ErrorInfo } from "next/error";

import { FaultPanel } from "@/components/console/fault-panel";

interface FaultBoundaryProps {
  title: string;
  detail?: string;
  compact?: boolean;
  className?: string;
}

function FaultFallback(
  { title, detail, compact, className }: FaultBoundaryProps,
  { unstable_retry }: ErrorInfo,
) {
  return (
    <FaultPanel
      title={title}
      detail={compact ? undefined : detail}
      compact={compact}
      className={className}
      onRetry={unstable_retry}
    />
  );
}

/**
 * A component-level error boundary, for a part of a screen that can fail
 * without taking the rest down: a 3D view whose GPU work threw, or one of the
 * status strip's panels. Without it a throw climbs to the route's error.tsx
 * and replaces the whole screen, drive controls included.
 *
 * Never wrap the emergency stop in one, nor put one between the stop and the
 * layout: the stop must not share a fate with anything that can fail.
 *
 * `unstable_catchError` rather than a hand-written class: it lets Next's own
 * thrown signals (redirect, notFound) through and clears on navigation.
 */
export const FaultBoundary = unstable_catchError(FaultFallback);

/**
 * The boundary every map view sits in — the dashboard's and the mapping
 * screen's 3D view, and the editor's floor plan and 3D map — so the controls
 * around a view that failed (drive, the tool strips, Save) stay usable.
 */
export function ViewportBoundary({ children }: { children: React.ReactNode }) {
  return (
    <FaultBoundary
      title="The map view stopped"
      detail="The controls around it still work. Try again to redraw the view."
    >
      {children}
    </FaultBoundary>
  );
}
