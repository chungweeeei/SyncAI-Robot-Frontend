// What the masthead says about the job that is running, and what it may do to
// it. Pure rules over the two reads the console has — the active list's entry
// and the run's own per-step state — so the component that draws them has
// nothing to decide, and so each rule can be stated as a test.
//
// Two of these rules are about epistemics, and the comments say which. A pause
// is a *request* the backend accepts at once and acts on when it can; PAUSED
// is a *reading* from the run's state. The masthead must never show the first
// as if it were the second, which is why the pending phase is derived from a
// request set against a reading, never stored and never cleared by an effect
// (the same shape as `pendingPolicy` in hooks/use-locomotion.ts).

import {
  isTerminalTaskStatus,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";
import { formatDuration } from "@/lib/recording/format";
import { isHistoryKind, kindLabel, runSeconds } from "@/lib/task/history";
import { STEP_TYPES } from "@/lib/task/step";

/**
 * The step the robot is on: the first one held or in progress.
 *
 * Null for an empty list (the backend degrades `steps` to [] whenever the
 * workflow query fails) and for one with nothing live — all PENDING in the
 * moment before the first step is dispatched, or all closed on the last read
 * of a run that just finished. Both are "nothing to say about a step", which
 * is not the same as "no job".
 */
export function currentStep(
  steps: readonly TaskStepState[],
): { index: number; step: TaskStepState } | null {
  const index = steps.findIndex(
    (step) => step.status === "IN_PROGRESS" || step.status === "PAUSED",
  );
  return index === -1 ? null : { index, step: steps[index]! };
}

/** The lower-cased wire type at the end of a composer step id, by type. */
const LABEL_BY_TYPE_WORD = new Map(
  STEP_TYPES.map((spec) => [spec.value.toLowerCase(), spec.label] as const),
);

/**
 * What a step is called, read off its id — the only thing the read carries.
 *
 * A step this console authored is `${ordinal}-${type}` (`stepIdFor` in
 * lib/task/step.ts) and reads as its type's label: Move, Speak, Stand, Lie. A
 * single-gesture run's one step is named after its kind (`goal`, `standup`,
 * `liedown`) and reads as the dashboard's own words for it. Anything else was
 * authored by another client and is shown verbatim: a name it chose is still
 * more telling than "Step", and guessing a type from it would be a claim.
 */
export function stepLabel(id: string): string {
  const composed = /^\d+-([a-z]+)$/.exec(id);
  if (composed) return LABEL_BY_TYPE_WORD.get(composed[1]!) ?? id;
  if (isHistoryKind(id)) return kindLabel(id);
  return id;
}

export interface StepProgress {
  /** 1-based, the way the composer numbers its rows. */
  ordinal: number;
  total: number;
  label: string;
}

/** Where the run is in its list, or null when no step is live (see currentStep). */
export function stepProgress(steps: readonly TaskStepState[]): StepProgress | null {
  const current = currentStep(steps);
  if (!current) return null;
  return {
    ordinal: current.index + 1,
    total: steps.length,
    label: stepLabel(current.step.id),
  };
}

/**
 * Whether the masthead offers a Pause for a job of this kind.
 *
 * A Stand or Lie down is one posture step, and a posture is not interrupted
 * by a pause: the step finishes and the run, having no next step, finishes
 * with it. A button that does nothing is worse than no button. Everything
 * else — a goal (one MOVE, which a pause does stop), a task, a scheduled run,
 * and a run whose kind the backend did not record — is offered the button,
 * and the backend's refusal is the answer when there is nothing to hold.
 */
export function pauseOffered(kind: string | null): boolean {
  return kind !== "standup" && kind !== "liedown";
}

/**
 * Whether the hold button (Pause or Resume) is on screen at all: the kind
 * allows one, and the run's own read has not already said it closed. The
 * active list lags the run by its poll interval plus the backend's cache, and
 * a button over a finished job would only earn a refusal. A read that has
 * not answered yet (null) keeps the button; the backend's sentence is the
 * answer if it is pressed too early.
 */
export function holdOffered(kind: string | null, status: TaskStatus | null): boolean {
  return pauseOffered(kind) && !isTerminalTaskStatus(status);
}

export type HoldVerb = "pause" | "resume";

/**
 * Where the job is between running and held, as the masthead draws it.
 *
 * `status` is the reading; `requested` is the verb the backend last accepted
 * for this run (see requestedHold). A request the reading has not caught up
 * with is the pending phase, and it resolves itself the moment a read agrees
 * — or stays pending, which is the truth, if none ever does.
 */
export type RunPhase = "running" | "pausing" | "paused" | "resuming";

export function runPhase(
  status: TaskStatus | null,
  requested: HoldVerb | null,
): RunPhase {
  if (requested === "pause" && status !== "PAUSED") return "pausing";
  if (requested === "resume" && status === "PAUSED") return "resuming";
  return status === "PAUSED" ? "paused" : "running";
}

/** The slice of a mutation this reads, so the rule needs no TanStack to test. */
export interface HoldRequestView {
  /** 0 for a mutation that has never run. */
  submittedAt: number;
  isSuccess: boolean;
  /** The task id the request was made for. */
  variables: unknown;
}

/**
 * The verb the backend most recently accepted for *this* run, or null.
 *
 * Only the later of the two requests counts, and only once it has succeeded:
 * a request still in flight has claimed nothing yet, and a refused one (the
 * run already closed) claims nothing at all. The id check is what retires a
 * stale claim without an effect — a pause accepted for the previous job says
 * nothing about the one that replaced it in the active list.
 */
export function requestedHold(
  pause: HoldRequestView,
  resume: HoldRequestView,
  taskId: string | null,
): HoldVerb | null {
  if (taskId === null) return null;
  const [verb, latest] =
    resume.submittedAt > pause.submittedAt
      ? (["resume", resume] as const)
      : (["pause", pause] as const);
  return latest.isSuccess && latest.variables === taskId ? verb : null;
}

/**
 * How long the run has been going, as `m:ss` / `h:mm:ss`, or "—" when the
 * two timestamps cannot be compared.
 *
 * Between two *server* clocks — the start and the active list's `as_of` —
 * never the browser's: the robot and the console are different machines and
 * the list is served from a short cache, so mixing them could show a job that
 * started a few seconds in the future. Shared by the masthead and the /tasks
 * banner so the same run cannot read two durations on one screen.
 */
export function runElapsed(startedAt: string, asOf: string | null): string {
  const seconds = runSeconds(startedAt, asOf);
  return seconds === null ? "—" : formatDuration(seconds);
}
