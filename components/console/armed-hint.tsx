"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";

/**
 * An armed tool's next step, spelled out because it happens on the map, away
 * from the tooltip. `role="status"` so it is heard when the tool arms. Shared
 * by both map surfaces.
 */
export function ArmedHint({
  tone,
  children,
}: {
  tone: "cmd" | "caution";
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      className={cn(
        overlayPanel,
        "instrument-label px-2 py-1.5",
        tone === "cmd"
          ? "border-signal-cmd/50 text-signal-cmd"
          : "border-signal-caution/50 text-signal-caution",
      )}
    >
      {children}
    </p>
  );
}
