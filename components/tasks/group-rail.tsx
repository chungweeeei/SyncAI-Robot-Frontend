import type { GroupPlace } from "@/lib/task/step";
import { cn } from "@/lib/utils";

/**
 * The rail beside the read-only step lines that start together — a saved
 * job's steps, a schedule's frozen copy, a finished run's results — so they
 * read as one block. A rail rather than the editor's box (step-group.tsx):
 * these are one-line readouts with no controls, and a box with a header round
 * every pair would outweigh the steps it holds.
 *
 * Absolutely placed in a `relative` line that reserves `pl-2.5` whether or not
 * it is in a group, so lines in and out of one keep their columns. `gap` is the
 * list's own `space-y`, which the rail reaches up across to join the line
 * above: a run of short segments would read as separate marks, not a block.
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
      {/* The rail is a picture; this is what it says, for a screen reader. */}
      {joined && <span className="sr-only">Starts together with the step above.</span>}
    </>
  );
}
