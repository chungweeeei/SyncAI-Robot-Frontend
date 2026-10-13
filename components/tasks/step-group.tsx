import * as React from "react";
import { Link2Icon, ScissorsIcon, Unlink2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The control in the gap between two items of the step editor: outside a box
 * it starts the two together (the item below joins the one above, either of
 * which may already be a box), inside one it splits the box there.
 *
 * It sits in the gap because that is where the link is — between two steps,
 * not on either of them — so there is no "together with which?" to puzzle
 * out. An icon until pointed at or focused, when it says what it does: a word
 * on every gap of a twenty-step list would drown the steps.
 *
 * Absent under a finger, where the gap closes up and the row's ⋯ menu carries
 * the same link: a 40 px target in every gap would double a long list's
 * height. Placed absolutely over the top band of the item below (its own
 * `pt-3.5`), which is the gap whether or not that band is inside a box.
 */
export function StepSeam({
  ref,
  kind,
  upper,
  blocked = null,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  kind: "join" | "split";
  /** The ordinal of the step above the gap; the one below is the next. */
  upper: number;
  /**
   * Why the two may not start together (stepLinkProblem), for a join only.
   * The seam stays where it is and says so rather than vanishing: a gap that
   * offers a link on every row but this one would read as a bug.
   */
  blocked?: string | null;
  onClick: () => void;
}) {
  const join = kind === "join";
  const lower = upper + 1;
  const refused = join && blocked !== null;
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-3.5 items-center justify-center pointer-coarse:hidden">
      <button
        ref={ref}
        type="button"
        // Starts with the words the button shows, so a voice command that
        // reads them off the screen still finds it.
        aria-label={
          refused
            ? `Can't start together: step ${upper} and step ${lower}. ${blocked}`
            : join
              ? `Start together: step ${upper} and step ${lower}`
              : `Split here: run step ${lower} after step ${upper}`
        }
        // aria-disabled rather than disabled, so the reason stays reachable:
        // a disabled button takes no focus and shows no title.
        aria-disabled={refused || undefined}
        title={refused ? blocked! : undefined}
        onClick={refused ? undefined : onClick}
        className={cn(
          "group/seam flex h-6 items-center gap-1 rounded-full border bg-panel px-1.5 text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          refused
            ? "cursor-not-allowed border-hairline hover:border-signal-warn/50 hover:text-signal-warn"
            : join
              ? "border-hairline hover:border-signal-cmd/50 hover:text-signal-cmd"
              : "border-signal-cmd/30 hover:border-foreground/30 hover:text-foreground",
        )}
      >
        {/* Scissors rather than a broken link: at this size the two link
         * glyphs are one blur, and the seams in and out of a box have to
         * read as opposites at a glance. */}
        {join ? (
          <Link2Icon className="size-3" aria-hidden />
        ) : (
          <ScissorsIcon className="size-3" aria-hidden />
        )}
        <span className="instrument-label hidden group-hover/seam:inline group-focus-visible/seam:inline">
          {refused ? "Can't start together" : join ? "Start together" : "Split here"}
        </span>
      </button>
    </div>
  );
}

/**
 * The top of a group's box: what the box means, and the one press that takes
 * it apart. Named by what the robot does with the steps rather than by the
 * wire's `group`, which is not a word an operator has any use for.
 */
export function StepGroupHeader({
  first,
  last,
  disabled,
  onUngroup,
}: {
  /** Ordinals of the box's first and last steps. */
  first: number;
  last: number;
  disabled: boolean;
  onUngroup: () => void;
}) {
  return (
    <div className="flex h-7 items-center gap-1.5 pl-1 pointer-coarse:h-11">
      <Link2Icon className="size-3 shrink-0 text-signal-cmd" aria-hidden />
      <span className="instrument-label shrink-0 text-signal-cmd">
        Start together
        <span className="sr-only">: steps {first} to {last}</span>
      </span>
      <span className="hidden min-w-0 truncate text-[11px] text-muted-foreground sm:inline">
        The next step waits for all of them.
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onUngroup}
        aria-label={`Ungroup steps ${first} to ${last}`}
        className="instrument-label ml-auto flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:h-10"
      >
        <Unlink2Icon className="size-3" aria-hidden />
        Ungroup
      </button>
    </div>
  );
}
