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
 * The running job, on every screen: Pause / Resume and Cancel, then one bar
 * reading job, step and — flush right — state. Icon buttons by request; the
 * names are on `aria-label` and `title`.
 *
 * **Nothing here comes and goes.** A vanishing control would slide its
 * neighbour under a finger mid-press, so an unholdable job greys Pause instead
 * of dropping it. And an empty bar looks like a broken one, so idle is said
 * in words.
 *
 * **Error is never drawn as idle**: a confident "no job" over a driving robot
 * is the one way this readout can do harm. As the strip narrows the job id
 * gives way first, then the step name, never the state word.
 */
export function ActiveRunControls() {
  const { run, status, asOf } = useActiveRun();

  if (run) {
    // Keyed by the run so the mutations (and any refusal shown) start over
    // with the next job.
    return <RunControls key={run.task.id} run={run} asOf={asOf} />;
  }

  // Loading is not idle: it gets the dash every unread instrument shows.
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

// From the task chip's table, so a run is one colour here and on /tasks. A
// pending request takes the colour of the state it is heading for.
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

/** The fixed pair, in the same place in every state (see above). */
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
 * A fixed frame, so the strip does not reflow as jobs come and go.
 * `role="status"` on the whole frame, so a step change or a hold is announced
 * as one sentence.
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
        // Absorbs the spare width; only the text on the left may be cut.
        "flex h-7 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-sm border border-hairline bg-elevated px-2.5",
        // No run, no state word: the tone goes on the whole frame.
        muted && (tone === "neutral" ? "text-muted-foreground" : TONE_TEXT[tone]),
      )}
    >
      {/* Nothing animates in here, by request. Not uppercased: the job id is
        * copied and grepped for, and an uppercased id is a different string. */}
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
  // The active list lags the run's own read, so a closed run lingers a moment;
  // both controls grey for it.
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

      {/* A finger has no hover, so the bar links to /tasks for the detail. */}
      <Link
        href="/tasks"
        aria-label={`${title} — open the job list`}
        title={`${title} · ${runElapsed(run.task.started_at, asOf)}${
          run.task.schedule_id ? ` · via ${run.task.schedule_id}` : ""
        }`}
        className="flex min-w-0 flex-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <RunBar tone={STATE_TONE[state]} state={state}>
          {/* The id is an engineer's handle: muted, and first to give way. */}
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
              {/* The step's detail, truncated before the step itself. */}
              {progress.message && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {progress.message}
                </span>
              )}
            </>
          ) : (
            <span className="readout">—</span>
          )}
        </RunBar>
      </Link>

      {/* Hangs under the strip (the header is the positioned ancestor), so a
        * refusal does not shift the viewport an operator may be aiming on. */}
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
