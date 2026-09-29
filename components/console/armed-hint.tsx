"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";

/**
 * An armed tool's next step, as a line of its own. `role="status"` so a
 * screen reader hears the instruction when the tool arms, which is when the
 * worded button it replaces used to change its name.
 *
 * Shared by the two map surfaces, like the tool strip they arm the tool from:
 * the dashboard viewport says where to aim a goal, the floor plan editor which
 * zone tool to pick. The instruction is spelled out here because the next
 * step happens on the map, where the pointer is no longer over the tooltip.
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
