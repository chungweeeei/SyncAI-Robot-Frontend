"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useActiveTasksSelect } from "@/hooks/use-console-active-tasks";
import {
  useRobotStateSelect,
  useRobotStateSilence,
  useRobotStateStatus,
} from "@/hooks/use-console-robot-state";
import { queryKeys } from "@/lib/api/query-keys";
import { setRobotState } from "@/lib/api/robot";
import type { ActiveTasksResponse } from "@/lib/api/task";
import {
  STUCK_JOB_AFTER_MS,
  gateSupported,
  stateAction,
  stateReading,
  stuckJobSuspected,
  type RobotStateTarget,
  type StateAction,
} from "@/lib/robot/readiness";
import type { RobotMode, RobotState, RobotStatus } from "@/lib/types/robot";

/**
 * POST /api/v1/robot/state — confirm the robot's position, withdraw that, or
 * release a latched error (lib/api/robot.ts's setRobotState).
 *
 * The answer is a receipt; the reading is the robot's next frame, and every
 * lock and chip in the console hangs off that frame's `state`. So the one
 * cache consequence is the frame itself: invalidated, not written, because
 * the answer carries the state word alone and the frame's sentence and
 * convergence moved with it. Without it the console would offer Confirm for
 * up to a poll's length after the robot took it.
 */
export function useSetRobotState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: RobotStateTarget) => setRobotState(target),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.robotState });
    },
  });
}

/**
 * Whether `held` has stayed true for `ms`. Falling drops it at once, during
 * render (an effect would be the synchronous setState the compiler lint
 * rejects); only the timer's callback raises it.
 */
function useHeldFor(held: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = React.useState(false);
  if (!held && elapsed) setElapsed(false);
  React.useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [held, ms]);
  return held && elapsed;
}

/** What the control reads off a frame; an object of unchanged fields is unchanged. */
const stateFacts = (frame: RobotState) => ({
  supported: gateSupported(frame),
  state: frame.state ?? null,
  converged: frame.localization_converged ?? false,
  message: frame.state_message ?? "",
  mode: frame.mode,
});

/** How long the robot's answer to a press stays on screen. */
const CLEAR_RECEIPT_AFTER_MS = 5000;

const anyRunning = (list: ActiveTasksResponse) => list.tasks.length > 0;
const RUNNING: readonly unknown[] = [true];
const IDLE: readonly unknown[] = [];

export interface RobotStateControl {
  /**
   * The robot's state word, or null when there is none to show: no frame
   * yet, a backend from before the state machine (whose word means something
   * else and which has no control to offer), or a robot that has stopped
   * reporting (`silent`).
   */
  state: RobotStatus | null;
  /**
   * The robot has a state machine and is not reporting it: the poll is
   * failing over a last frame, whose word is a memory and is withheld. No
   * action is offered; the masthead's chip goes neutral beside the link chip, which is what says the link is
   * down.
   */
  silent: boolean;
  /**
   * The backend's sentence for that silence ("The robot has not reported its
   * state for 4 seconds."), or null: not silent, or a failure with no
   * sentence for an operator (a dropped link).
   */
  silence: string | null;
  /** The robot's own sentence about that state; "" when it has none. */
  message: string;
  mode: RobotMode | null;
  /**
   * The one thing that may be done about the state, with why it is greyed if
   * it is; null when the state offers nothing, which is also when the
   * masthead's chip is not a button.
   */
  action: StateAction | null;
  /** The robot counts a job as running that the job list has not had for a while. */
  stuck: boolean;
  busy: boolean;
  /** The backend's refusal of the last press, or null. Rendered verbatim. */
  error: string | null;
  /**
   * The robot's answer to the last press, for a few seconds and only while
   * it reports the state that answer named: a receipt for the state on
   * screen, never one over a state that has since moved on.
   */
  receipt: string | null;
  apply: (target: RobotStateTarget) => void;
  /** Drops the last press's refusal or receipt. */
  reset: () => void;
}

/**
 * The robot's state machine as an operator's control: the state, what may be
 * done about it, and the press. Read off the console's two shared polls
 * through selectors — no request of its own, and no re-render at their rate —
 * so the masthead's chip can mount it on every screen.
 *
 * Only while the robot-state poll is healthy: a frame it has not renewed is
 * not the robot's word, so the state, its sentence and every action are
 * withheld (`silent`) until frames resume.
 *
 * The rules are lib/robot/readiness.ts's; this adds only the clock a stuck
 * job is judged against.
 */
export function useRobotStateControl(): RobotStateControl {
  const facts = useRobotStateSelect(stateFacts);
  // The selector hands out the last frame through a failing poll; whether it
  // is still the robot's word is the poll's status (stateReading).
  const reading = stateReading({ frame: facts, status: useRobotStateStatus() });
  const silence = useRobotStateSilence();
  const { data: running, status } = useActiveTasksSelect(anyRunning);
  // The rules read only whether there is a job.
  const tasks = running ? RUNNING : IDLE;

  const state = reading.kind === "live" ? reading.state : null;
  const mode = facts?.mode ?? null;
  const converged = facts?.converged ?? false;

  const stuck = useHeldFor(stuckJobSuspected({ state, tasks, status }), STUCK_JOB_AFTER_MS);

  const { mutate, reset, isPending, isSuccess, error, data } = useSetRobotState();

  // A receipt clears itself, as an auto-localize match does: the chip is the
  // lasting reading, and a sentence left standing would be read again over
  // the next time the robot is in the same state. A refusal stays.
  React.useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, CLEAR_RECEIPT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  const action = React.useMemo(
    () => (state === null ? null : stateAction({ state, converged, mode, tasks, status, stuck })),
    [state, converged, mode, tasks, status, stuck],
  );

  return {
    state,
    silent: reading.kind === "silent",
    message: state !== null ? (facts?.message ?? "") : "",
    mode,
    action,
    stuck,
    silence: reading.kind === "silent" ? silence : null,
    busy: isPending,
    error: error?.message ?? null,
    receipt: data && data.state === state ? data.message : null,
    apply: mutate,
    reset,
  };
}
