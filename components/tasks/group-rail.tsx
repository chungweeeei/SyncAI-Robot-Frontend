import type { GroupPlace } from "@/lib/task/step";
import { cn } from "@/lib/utils";

/**
 * The rail beside read-only step lines that start together, so they read as
 * one block. A rail, not the editor's box: a box round one-line readouts would
 * outweigh them.
 *
 * Placed in a `relative` line that always reserves `pl-2.5`, so columns line
 * up. `gap` is the list's `space-y`, which the rail spans to join the line
 * above into one mark.
 */
export function GroupRail({ place, gap }: { place: GroupPlace; gap: "0.5" | "1" }) {
  if (place === null) return null;
  const joined = place === "middle" || place === "end";
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 w-0.5 rounded-full bg-signal-cmd/70",
          joined ? (gap === "1" ? "-top-1" : "-top-0.5") : "top-0.5",
          place === "end" ? "bottom-0.5" : "bottom-0",
        )}
      />
      {joined && <span className="sr-only">Starts together with the step above.</span>}
    </>
  );
}
