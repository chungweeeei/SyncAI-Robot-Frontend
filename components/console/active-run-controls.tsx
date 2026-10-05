"use client";

import Link from "next/link";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";

import { TONE_TEXT, type Tone } from "@/components/console/instrument";
import { STATUS_TONE } from "@/components/console/task-chip";
import { useActiveRun, type ActiveRun } from "@/hooks/use-active-run";
import { useCancelTask } from "@/hooks/use-cancel-task";
import { useTaskHold } from "@/hooks/use-task-hold";
import { describeRun } from "@/lib/task/history";
import {
  holdOffered,
  runClosed,
  runElapsed,
  runState,
  stepProgress,
  type RunState,
} from "@/lib/task/run";
import { cn } from "@/lib/utils";

/**
 * What the robot is executing, on every screen, and the two things an operator
 * may do to it from there: hold or release it, and stop it.
 *
 * Laid out as a control cluster and then one bar, by request. The buttons come
 * first and stay together, so the two presses are in one place the hand learns
 * once; the bar after them is one long readout. Inside it, left to right:
 * which job, which step, and — flush right, where the eye lands last — what
 * that job is doing.
 *
 * **Nothing here comes and goes.** Both the cluster and the bar are drawn in
 * every state, and what changes is what they say and whether they are enabled.
 * Two reasons, and they are different reasons:
 *
 *  - A control that disappears moves the one beside it, and these two sit a
 *    gap apart from each other precisely so a finger cannot slip between
 *    them. A Cancel that slides left into where Pause used to be, between the
 *    press starting and the finger landing, is the one thing this layout is
 *    built to prevent. So a job that cannot be held greys its Pause instead of
 *    dropping it, and the title says why.
 *  - An empty slot is also what a broken readout looks like. The bar used to
 *    render nothing while idle, on the grounds that "nothing is happening"
 *    needs no words; an operator asked for the opposite, and a bar that says
 *    in so many words that the queue is empty cannot be mistaken for one that
 *    failed to draw.
 *
 * The three states it holds are still not symmetric. **Error is never drawn
 * as idle**: a failed poll means the console does not know, and a confident
 * "no job" over a robot that is driving is the one way this readout can do
 * harm. It says so in the caution hue. And **a job never hides** at any
 * width — what gives way as the strip narrows is the job id, then the step's
 * name, never the state word.
 *
 * The buttons are icons only, by request; the name is on `aria-label` and
 * `title`.
 */
export function ActiveRunControls() {
  const { run, status, asOf } = useActiveRun();

  if (run) {
    // Keyed by the run, so the hold and cancel mutations below — and the
    // refusal one of them may be showing — start over with the next job
    // rather than carrying a previous job's sentence under a new one.
    return <RunControls key={run.task.id} run={run} asOf={asOf} />;
  }

  // Nothing to act on, so both controls are out and the bar says which of
  // the three "no run" states this is. Loading is not idle: the console has
  // not been told yet, and a dash is what every other unread instrument in
  // this strip shows.
  const idle =
    status === "loading"
      ? { tone: "neutral" as Tone, text: "—", title: undefined }
      : status === "error"
        ? {
            tone: "caution" as Tone,
            text: "Job list unavailable",
            title:
              "The robot's job scheduler could not be reached. This is the last status the console saw, not a current reading.",
          }
        : {
            tone: "neutral" as Tone,
            text: "No task message in queue",
            title: undefined,
          };

  return (
    <>
      <Controls
        hold="pause"
        holdDisabled
        holdTitle="No job is running."
        onHold={noop}
        cancelDisabled
        cancelTitle="No job is running."
        onCancel={noop}
      />
      <RunBar tone={idle.tone} title={idle.title} muted>
        {idle.text}
      </RunBar>
    </>
  );
}

const noop = () => {};

/** The word the bar ends in. */
const STATE_WORD: Record<RunState, string> = {
  running: "Running",
  pausing: "Pausing…",
  paused: "Paused",
  resuming: "Resuming…",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

// Read off the task chip's table rather than restated, which is the whole
// reason that table is exported: a held run cannot be one colour in the
// masthead and another on /tasks. A request the reading has not caught up
// with takes the colour of the state it is heading for — Pausing… is already
// PAUSING's caution on the wire, and Resuming… is heading back to running.
const STATE_TONE: Record<RunState, Tone> = {
  running: STATUS_TONE.IN_PROGRESS,
  pausing: STATUS_TONE.PAUSING,
  paused: STATUS_TONE.PAUSED,
  resuming: STATUS_TONE.IN_PROGRESS,
  completed: STATUS_TONE.COMPLETED,
  failed: STATUS_TONE.FAILED,
  canceled: STATUS_TONE.CANCELED,
};

const CONTROL_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-sm border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-35 pointer-coarse:size-10";

const HOLD_BUTTON =
  "border-signal-cmd/40 bg-signal-cmd/8 text-signal-cmd hover:bg-signal-cmd/20 disabled:hover:bg-signal-cmd/8";

const CANCEL_BUTTON =
  "border-signal-warn/50 bg-signal-warn/12 text-signal-warn hover:bg-signal-warn/20 disabled:hover:bg-signal-warn/12";

/**
 * The fixed pair: hold (as Pause or as Resume) and Cancel, in that order and
 * at that spacing in every state. See the note above on why neither ever
 * leaves the row.
 */
function Controls({
  hold,
  holdDisabled,
  holdTitle,
  onHold,
  cancelDisabled,
  cancelTitle,
  onCancel,
}: {
  hold: "pause" | "resume";
  holdDisabled: boolean;
  holdTitle: string;
  onHold: () => void;
  cancelDisabled: boolean;
  cancelTitle: string;
  onCancel: () => void;
}) {
  const HoldIcon = hold === "pause" ? PauseIcon : PlayIcon;
  return (
    <div
      role="group"
      aria-label="Running job"
      className="flex shrink-0 items-center gap-1"
    >
      <button
        type="button"
        aria-label={hold === "pause" ? "Pause the job" : "Resume the job"}
        title={holdTitle}
        disabled={holdDisabled}
        onClick={onHold}
        className={cn(CONTROL_BUTTON, HOLD_BUTTON)}
      >
        <HoldIcon className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Cancel the job"
        title={cancelTitle}
        disabled={cancelDisabled}
        onClick={onCancel}
        className={cn(CONTROL_BUTTON, CANCEL_BUTTON)}
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The long readout itself: a frame that keeps its height and its right edge
 * whatever is inside it, so the strip does not reflow as jobs come and go.
 *
 * `role="status"` so a step change, and a hold landing, are announced rather
 * than just redrawn. It is on the frame rather than on the state word alone
 * because the two halves are one sentence to a screen reader.
 */
function RunBar({
  tone,
  title,
  state,
  muted,
  children,
}: {
  tone: Tone;
  title?: string;
  /** The word at the right end; omitted for a bar with nothing running. */
  state?: RunState;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      title={title}
      className={cn(
        // min-w-0 and flex-1: the bar is what absorbs the strip's spare width,
        // and the one thing in it allowed to be cut is the text on the left.
        // The strip is bg-panel, so the bar reads as recessed into it — the
        // same relation the viewport well has to the panels around it.
        "flex h-7 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-sm border border-hairline bg-elevated px-2.5",
        // A bar with no run carries its tone on the whole frame, since it
        // has no state word to put it on.
        muted && (tone === "neutral" ? "text-muted-foreground" : TONE_TEXT[tone]),
      )}
    >
      {/* Nothing animates in here, by request. A job that is going says so
        * in the state word, and the step changing is the other thing that
        * moves; a looping sweep behind a readout an operator reads all day
        * is motion that repeats a fact already on the row. The strip's
        * bottom edge still carries the one animation in the console, and
        * that one encodes an arrival. */}
      {/* Sentence case, not the strip's uppercase instrument label: the job
        * id is a string an engineer copies and greps for, and an uppercased
        * copy of it is a different string. */}
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
        {children}
      </span>
      {state !== undefined && (
        <span
          className={cn(
            "instrument-label shrink-0 whitespace-nowrap",
            TONE_TEXT[tone],
          )}
        >
          {STATE_WORD[state]}
        </span>
      )}
    </div>
  );
}

function RunControls({ run, asOf }: { run: ActiveRun; asOf: string | null }) {
  const hold = useTaskHold(run.task.id);
  const cancel = useCancelTask();

  const state = runState(run.status, hold.requested);
  const held = state === "paused" || state === "resuming";
  const progress = stepProgress(run.steps);
  const { title } = describeRun(run.task);
  const holdable = holdOffered(run.task.kind, run.status);
  // The active list lags the run's own read by its poll interval plus the
  // backend's cache, so a closed run sits here for a moment longer. Both
  // controls go out for it: there is nothing left to hold or to stop, and a
  // press would only earn a refusal.
  const closed = runClosed(state);
  const error = hold.error ?? cancel.error?.message ?? null;

  return (
    <>
      <Controls
        hold={held ? "resume" : "pause"}
        holdDisabled={
          !holdable || hold.busy || state === "pausing" || state === "resuming"
        }
        holdTitle={
          closed
            ? "This job has finished."
            : !holdable
              ? "This job is a single posture and finishes on its own; there is nothing to hold."
              : held
                ? "Resume the job"
                : "Pause the job"
        }
        onHold={() => void (held ? hold.resume() : hold.pause())}
        cancelDisabled={cancel.isPending || closed}
        cancelTitle={closed ? "This job has finished." : "Cancel the job"}
        onCancel={() => cancel.mutate(run.task.id)}
      />

      {/* A finger has no hover, so the bar is also the way to /tasks, where
        * the run is listed with its per-step detail. */}
      <Link
        href="/tasks"
        aria-label={`${title} — open the job list`}
        title={`${title} · ${runElapsed(run.task.started_at, asOf)}${
          run.task.schedule_id ? ` · via ${run.task.schedule_id}` : ""
        }`}
        className="flex min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <RunBar tone={STATE_TONE[state]} state={state}>
          {/* The id is what the orchestrator calls this run — an engineer's
            * handle, so it is set in the readout face, muted, and is the
            * first thing to give way. The step is what an operator is
            * actually watching, so it keeps the room. */}
          <span className="readout hidden text-muted-foreground lg:inline">
            {run.task.id} ·{" "}
          </span>
          {progress ? (
            <>
              {progress.total > 1 && (
                <span className="readout">
                  {progress.ordinal}/{progress.total}{" "}
                </span>
              )}
              <span>{progress.label}</span>
            </>
          ) : (
            <span className="readout">—</span>
          )}
        </RunBar>
      </Link>

      {/* Under the strip rather than in it: the row has no room for a
        * sentence, and shifting the page below for a refusal would move
        * the viewport an operator may be aiming on. The header is the
        * positioned ancestor. Verbatim — it is the backend's sentence. */}
      {error && (
        <p
          role="alert"
          className="absolute inset-x-0 top-full z-20 border-b border-signal-warn/40 bg-panel px-3 py-1.5 text-[11px] leading-snug break-words text-signal-warn sm:px-4"
        >
          {error}
        </p>
      )}
    </>
  );
}
