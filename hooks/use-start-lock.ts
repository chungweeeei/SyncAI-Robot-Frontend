"use client";

import * as React from "react";

import { useRobotStateSelect, useRobotStateStatus } from "@/hooks/use-console-robot-state";
import type { RunLock } from "@/lib/map/run-lock";
import { gateSupported, startLock } from "@/lib/robot/readiness";
import type { RobotState } from "@/lib/types/robot";

/** The two facts the lock is made of; an object of unchanged fields is unchanged. */
const readiness = (frame: RobotState) => ({
  state: frame.state ?? null,
  supported: gateSupported(frame),
});

/**
 * Whether a job may be started given the robot's own state — an error it
 * holds until released, or a position nobody has confirmed — off the
 * console's shared robot-state poll, with no request of its own. The rule,
 * and why it fails open, is lib/robot/readiness.ts's startLock.
 *
 * `needsLocalization` is whether the job drives on the map (lib/task's
 * needsLocalization for a step list, runNeedsLocalization for a run read
 * back). Selected down to the state word, so a screen this is mounted in is
 * re-rendered when the verdict could change and not at the poll's 1 Hz.
 *
 * Through a failing poll it goes on judging by the last frame, as every gate
 * here does (Run by the last frame's robot id, Auto localize by its mode,
 * the stop by its safety lock): a hold the robot last reported stays, and a
 * press the last frame allowed goes through, where the robot's own refusal
 * answers it. Withholding the state chip's word is a different matter — that
 * chip would be *showing* a memory as a reading; this only greys a press
 * first, and locking every start on a dropped poll would take the robot's
 * controls away on the console's own link. Its reason, though, says the
 * robot is silent rather than repeat the last frame's word.
 */
export function useStartLock(needsLocalization: boolean): RunLock {
  const read = useRobotStateSelect(readiness);
  // A status flip re-renders only on the flip itself.
  const silent = useRobotStateStatus() !== "ok";
  const { locked, reason } = startLock({
    state: read?.state,
    supported: read?.supported ?? false,
    needsLocalization,
    silent,
  });
  return React.useMemo(() => ({ locked, reason }), [locked, reason]);
}
