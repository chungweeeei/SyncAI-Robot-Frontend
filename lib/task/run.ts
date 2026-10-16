// What the masthead says about the running job and what it may do to it: pure
// rules over the active list's entry and the run's own per-step state.
//
// A pause is a *request* the backend accepts at once and acts on when it can;
// PAUSED is a *reading*. The masthead must never show the first as the second,
// so the pending phase is derived from request against reading — never stored,
// never cleared by an effect (cf. `pendingPolicy` in hooks/use-locomotion.ts).

import {
  isTerminalTaskStatus,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";
import { formatDuration } from "@/lib/recording/format";
import type { PlanarPose } from "@/lib/types/robot";
import { isHistoryKind, kindLabel, runSeconds } from "@/lib/task/history";
import { STEP_TYPES } from "@/lib/task/step";

/**
 * The step the robot is on: the first one held or in progress.
 *
 * Null for an empty list (the backend degrades `steps` to [] when its workflow
 * query fails) and for one with nothing live (all PENDING before the first
 * dispatch, or all closed on a run's last read). That means "nothing to say
 * about a step", not "no job".
 */
export function currentStep(
  steps: readonly TaskStepState[],
): { index: number; step: TaskStepState } | null {
  const index = steps.findIndex(live);
  return index === -1 ? null : { index, step: steps[index]! };
}

const LABEL_BY_TYPE_WORD = new Map(
  STEP_TYPES.map((spec) => [spec.value.toLowerCase(), spec.label] as const),
);

/**
 * What a step is called, read off its id — the only thing the read carries.
 *
 * `${ordinal}-${type}` (`stepIdFor`) reads as its type's label; a
 * single-gesture run's step is named after its kind (`goal`, `standup`,
 * `liedown`). Any other id came from another client and is shown verbatim:
 * guessing a type from it would be a claim.
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
  /** One step's label, or the live ones of a group joined: "Move + Speak". */
  label: string;
  /** The live step's `message` (what the robot is doing), "" when it has none. */
  message: string;
}

function live(step: TaskStepState): boolean {
  return step.status === "IN_PROGRESS" || step.status === "PAUSED";
}

/**
 * The dock a live DOCK step is driving onto, or null.
 *
 * Any live step, not only `currentStep`: a group runs at once and holds at
 * most one Dock, which need not be its first member. A held Dock still
 * answers — the target has not moved, and the staging point is where the
 * robot will head when it resumes.
 */
export function liveDock(steps: readonly TaskStepState[]): PlanarPose | null {
  return steps.find((step) => live(step) && step.dock)?.dock ?? null;
}

/**
 * Where the run is in its list, or null when no step is live.
 *
 * A group runs at once, so "the" step can be several: the label names every
 * member still live (a finished Speak beside a long Move is no longer news)
 * and the ordinal is the first one's. Only a Move carries a message, and a
 * group holds at most one.
 */
export function stepProgress(steps: readonly TaskStepState[]): StepProgress | null {
  const current = currentStep(steps);
  if (!current) return null;
  const group = current.step.group;
  const members = group
    ? steps.filter((step) => step.group === group && live(step))
    : [current.step];
  return {
    ordinal: current.index + 1,
    total: steps.length,
    label: members.map((step) => stepLabel(step.id)).join(" + "),
    message: members.find((step) => step.message)?.message ?? "",
  };
}

/**
 * Whether the masthead offers a Pause for a job of this kind.
 *
 * A Stand or Lie down is one posture step, which a pause does not interrupt —
 * the run just finishes — and a button that does nothing is worse than none.
 * Every other kind, unknown included, gets the button; the backend's refusal
 * answers when there is nothing to hold.
 */
export function pauseOffered(kind: string | null): boolean {
  return kind !== "standup" && kind !== "liedown";
}

/**
 * Whether the hold button (Pause or Resume) is on screen: the kind allows one
 * and the run's own read has not said it closed. The active list lags the run,
 * and a button over a finished job would only earn a refusal. An unanswered
 * read (null) keeps the button.
 */
export function holdOffered(kind: string | null, status: TaskStatus | null): boolean {
  return pauseOffered(kind) && !isTerminalTaskStatus(status);
}

export type HoldVerb = "pause" | "resume";

/**
 * Where the job is between running and held.
 *
 * `status` is the reading; `requested` is the verb the backend last accepted
 * (see requestedHold). A request the reading has not caught up with is the
 * pending phase; it resolves the moment a read agrees, or stays pending —
 * which is the truth — if none ever does.
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

/**
 * Every word the masthead's bar can end in: the four phases plus the three
 * ways a run closes. `runPhase` answers "running" for a closed run, which is
 * right for the buttons but wrong for a readout: the bar stays up between a
 * run ending and the active list noticing.
 */
export type RunState = RunPhase | "completed" | "failed" | "canceled";

/**
 * How a run reads, terminal states first: "Pausing…" over a run canceled from
 * elsewhere would be a claim the reading has already contradicted.
 */
export function runState(
  status: TaskStatus | null,
  requested: HoldVerb | null,
): RunState {
  if (status === "COMPLETED") return "completed";
  if (status === "FAILED") return "failed";
  if (status === "CANCELED") return "canceled";
  return runPhase(status, requested);
}

/**
 * Whether the run is over, with nothing left to hold or stop. Read off the
 * state so a component need not import `isTerminalTaskStatus` from lib/api.
 */
export function runClosed(state: RunState): boolean {
  return state === "completed" || state === "failed" || state === "canceled";
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
 * Only the later request counts, and only once it succeeded: one in flight or
 * refused claims nothing. The id check retires a stale claim without an
 * effect — a pause accepted for the previous job says nothing about this one.
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
 * How long the run has been going (`m:ss` / `h:mm:ss`), or "—".
 *
 * Measured between two *server* clocks — the start and the list's `as_of` —
 * never the browser's: they are different machines and the list is cached, so
 * mixing them could show a job starting in the future. Shared by the masthead
 * and the /tasks banner so one run cannot read two durations on one screen.
 */
export function runElapsed(startedAt: string, asOf: string | null): string {
  const seconds = runSeconds(startedAt, asOf);
  return seconds === null ? "—" : formatDuration(seconds);
}
