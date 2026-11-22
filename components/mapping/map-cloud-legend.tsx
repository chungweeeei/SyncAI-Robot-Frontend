"use client";

import { useTheme } from "next-themes";

import { overlayPanel } from "@/components/console/instrument";
import { STREAMED_MAP_STYLE, type StreamedMapLayer } from "@/lib/scene/map-cloud-layer";
import { THEMES } from "@/lib/scene/theme";
import { cssHex } from "@/lib/theme/signal";
import { cn } from "@/lib/utils";

const ENTRIES: ReadonlyArray<{ layer: StreamedMapLayer; label: string }> = [
  { layer: "saved", label: "Saved map" },
  { layer: "run", label: "Added this run" },
];

/**
 * Which colour is which on a resumed run: the saved map it continues, and
 * what the run has added to it (only what the saved map lacks, so "added"
 * is the word). Only while the viewport draws a saved map — a run begun
 * empty has one colour and needs no key. The swatches are the marks
 * themselves (STREAMED_MAP_STYLE), so a retuned colour cannot leave the key
 * describing the old one. Mounted only once a frame has arrived, so reading
 * the resolved theme here cannot disagree with the server render.
 */
export function MapCloudLegend({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];

  return (
    <ul
      aria-label="Map colours"
      className={cn(overlayPanel, "flex h-6 items-center gap-3 px-2 pointer-coarse:h-10", className)}
    >
      {ENTRIES.map(({ layer, label }) => {
        const style = STREAMED_MAP_STYLE[layer];
        return (
          <li
            key={layer}
            className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground"
          >
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: cssHex(style.color(theme)), opacity: style.opacity }}
            />
            {label}
          </li>
        );
      })}
    </ul>
  );
}
