"use client";

import Link from "next/link";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { STATUS_TONE } from "@/components/console/task-chip";
import { useActiveRun, type ActiveRun } from "@/hooks/use-active-run";
import { useCancelTask } from "@/hooks/use-cancel-task";
import { useTaskHold } from "@/hooks/use-task-hold";
import { describeRun } from "@/lib/task/history";
import {
  holdOffered,
  runElapsed,
  runPhase,
  stepProgress,
  type RunPhase,
} from "@/lib/task/run";
import { cn } from "@/lib/utils";

/**
 * What the robot is executing, on every screen, and the three things an
 * operator may do to it from there: hold it, release it, stop it.
 *
 * The readout is the step, not the job: `2/5 Move` says more about a robot
 * crossing a warehouse than "RUNNING" did, and the job's own name is one
 * hover away in the title. No "Task" label and no IDLE chip — "nothing is
 * happening" is the state nobody needs to be told, and the row is the widest
 * on the screen. The three states that remain are not symmetric, on purpose:
 *
 *  - **Error is never drawn as idle.** A failed poll means the console does
 *    not know, and a confident empty slot over a robot that is driving is the
 *    one way this readout can do harm. It says so in the caution hue.
 *  - **A job never hides**, at any width. It is the only thing on this strip
 *    that says a machine is moving.
 *
 * The buttons are icons only, by request; the name is on `aria-label` and
 * `title`. Pause stands before the readout and Cancel after it, so the two
 * are never neighbours a finger can slip between — the same reasoning that
 * has Remove step ask a finger twice.
 */
export function ActiveRunControls() {
  const { run, status, asOf } = useActiveRun();

  // First paint: the strip's own Link chip already says the console is still
  // finding its feet, and a second "…" beside it adds nothing.
  if (status === "loading") return null;

  if (status === "error") {
    return (
      <Chip
        tone="caution"
        title="The robot's job scheduler could not be reached. This is the last status the console saw, not a current reading."
      >
        TASK ?
      </Chip>
    );
  }

  if (!run) return null;

  // Keyed by the run, so the hold and cancel mutations below — and the
  // refusal one of them may be showing — start over with the next job rather
  // than carrying a previous job's sentence under a new one.
  return <RunControls key={run.task.id} run={run} asOf={asOf} />;
}

/** The word appended to the readout while the run is not simply running. */
const PHASE_WORD: Record<Exclude<RunPhase, "running">, string> = {
  pausing: "Pausing…",
  paused: "Paused",
  resuming: "Resuming…",
};

const HOLD_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-sm border border-signal-cmd/40 bg-signal-cmd/8 text-signal-cmd transition-colors hover:bg-signal-cmd/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-signal-cmd/8 pointer-coarse:size-10";

const CANCEL_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-sm border border-signal-warn/50 bg-signal-warn/12 text-signal-warn transition-colors hover:bg-signal-warn/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-signal-warn/12 pointer-coarse:size-10";

function RunControls({ run, asOf }: { run: ActiveRun; asOf: string | null }) {
  const hold = useTaskHold(run.task.id);
  const cancel = useCancelTask();

  const phase = runPhase(run.status, hold.requested);
  const held = phase === "paused" || phase === "resuming";
  const progress = stepProgress(run.steps);
  const { title } = describeRun(run.task);
  const holdable = holdOffered(run.task.kind, run.status);
  const error = hold.error ?? cancel.error?.message ?? null;

  return (
    <div role="group" aria-label="Running job" className="flex items-center gap-1.5">
      {holdable &&
        (held ? (
          <button
            type="button"
            aria-label="Resume the job"
            title="Resume the job"
            disabled={hold.busy || phase === "resuming"}
            onClick={() => void hold.resume()}
            className={HOLD_BUTTON}
          >
            <PlayIcon className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Pause the job"
            title="Pause the job"
            disabled={hold.busy || phase === "pausing"}
            onClick={() => void hold.pause()}
            className={HOLD_BUTTON}
          >
            <PauseIcon className="size-3.5" aria-hidden />
          </button>
        ))}

      {/* A finger has no hover, so the readout is also the way to /tasks,
        * where the run is listed with its per-step detail. `role="status"`
        * so a step change, and a hold landing, are announced rather than
        * just redrawn. */}
      <Link
        href="/tasks"
        aria-label={`${title} — open the job list`}
        title={`${title} · ${runElapsed(run.task.started_at, asOf)}${
          run.task.schedule_id ? ` · via ${run.task.schedule_id}` : ""
        }`}
        className="rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Chip
          tone={held ? STATUS_TONE.PAUSED : STATUS_TONE.IN_PROGRESS}
          className="relative gap-1 overflow-hidden"
        >
          <span role="status" className="contents">
            {/* The sweep is the only animated thing in the console besides
              * the strip's heartbeat, and it says one thing: still moving.
              * It stops the moment the run is held or a hold is pending. */}
            {phase === "running" && (
              <span
                aria-hidden
                className="run-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-signal-active/30 to-transparent"
              />
            )}
            {progress ? (
              <>
                {progress.total > 1 && (
                  <span className="readout">
                    {progress.ordinal}/{progress.total}
                  </span>
                )}
                {/* The type word gives way first at 375 px; the count stays. */}
                <span className={cn(progress.total > 1 && "hidden sm:inline")}>
                  {progress.label}
                </span>
              </>
            ) : (
              <span className="readout">—</span>
            )}
            {phase !== "running" && <span>· {PHASE_WORD[phase]}</span>}
          </span>
        </Chip>
      </Link>

      <button
        type="button"
        aria-label="Cancel the job"
        title="Cancel the job"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate(run.task.id)}
        className={CANCEL_BUTTON}
      >
        <XIcon className="size-3.5" aria-hidden />
      </button>

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
    </div>
  );
}
