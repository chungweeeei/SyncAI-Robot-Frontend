"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ignore, writeState } from "@/lib/api/mutation-state";
import {
  setMotionKey,
  setPolicyMode,
  type MotionKey,
  type PolicyMode,
} from "@/lib/api/robot";
import { controllerAfterMotion, type Controller } from "@/lib/robot/controller";
import type { RobotLowLevelMode } from "@/lib/types/robot";

export type { Controller } from "@/lib/robot/controller";

/** Which learned policy the RL controller should load. */
export type Policy = "PPO" | "HIMLOCO";

/** The motion keys that select a controller; postures are PanelPostureControl's. */
const CONTROLLER_KEY: Record<Controller, MotionKey> = {
  RL: "1",
  MPC: "5",
};

const POLICY_MODE: Record<Policy, PolicyMode> = {
  PPO: 0,
  HIMLOCO: 1,
};

/**
 * Reported policies this control can light. `CHAMP`, `ISSAC` or `UNKNOWN` light
 * nothing: the robot is running something this control cannot ask for.
 */
const REPORTED_POLICY: Record<string, Policy> = {
  PPO: "PPO",
  HIMLOCO: "HIMLOCO",
};

export interface LocomotionControl {
  /**
   * Commanded, defaulting to RL, and dropped back to RL when the motion arrives
   * at IDLE or LOCOMOTION. Not readable back — see the note below.
   */
  controller: Controller;
  /** The policy to light: the reported one, or a pending request. */
  policy: Policy | null;
  /** A requested policy the robot has not reported yet; shown as unconfirmed. */
  pendingPolicy: Policy | null;
  busy: boolean;
  error: string | null;
  selectController: (controller: Controller) => Promise<void>;
  selectPolicy: (policy: Policy) => Promise<void>;
}

/**
 * Controller (RL / MPC) and, under RL, the learned policy (PPO / HIMLOCO).
 *
 * **The two halves have different epistemics, and the UI has to reflect that.**
 *
 * `policy` is MEASURED: `low_level_mode.policy` is the controller's own answer,
 * so the lit segment is what the robot runs, and a request that never takes
 * effect stays visibly unconfirmed.
 *
 * `controller` is COMMANDED and defaults to RL, because it cannot be read
 * back: **MPC has no known motion code**. RL is a starting assumption, not a
 * reading. An arrival at IDLE (the controller restarts under RL) or LOCOMOTION
 * (RL's gait) overrules a commanded MPC — see `controllerAfterMotion` for why
 * on the edge, not the level.
 *
 * The POST returns once a UDP datagram is written while `robot_state` polls at
 * 1 Hz, so `pendingPolicy` bridges the gap. It is DERIVED (request !== report),
 * not cleared by an effect: it resolves the moment a frame confirms, and stays
 * pending if none ever does, which is the truth.
 */
export function useLocomotion(
  reported: RobotLowLevelMode | null,
): LocomotionControl {
  const [controller, setController] = React.useState<Controller>("RL");
  const motion = reported?.motion ?? null;
  // The motion the rule last saw, adjusted at render time: an effect would
  // paint one frame of a stale MPC, and the compiler lint rejects a sync
  // setState in one.
  const [seenMotion, setSeenMotion] = React.useState(motion);
  if (motion !== seenMotion) {
    setSeenMotion(motion);
    const next = controllerAfterMotion(controller, seenMotion, motion);
    if (next !== controller) setController(next);
  }
  const [requestedPolicy, setRequestedPolicy] = React.useState<Policy | null>(null);

  const reportedPolicy = reported
    ? REPORTED_POLICY[reported.policy] ?? null
    : null;

  // Derived: null as soon as a frame agrees with the request.
  const pendingPolicy =
    requestedPolicy && requestedPolicy !== reportedPolicy ? requestedPolicy : null;

  const controllerRequest = useMutation({
    mutationFn: async (next: Controller) => {
      const result = await setMotionKey(CONTROLLER_KEY[next]);
      // `sent` is always true for these keys today, but honouring it keeps a
      // future refusal from looking applied; thrown so it lands in `error`.
      if (!result.sent) throw new Error(result.message);
      return next;
    },
    onSuccess: (next) => setController(next),
  });

  const policyRequest = useMutation({
    mutationFn: async (next: Policy) => {
      await setPolicyMode(POLICY_MODE[next]);
      return next;
    },
    // Records the request only; the report still decides what is lit.
    onSuccess: (next) => setRequestedPolicy(next),
  });

  const { mutateAsync: requestController } = controllerRequest;
  const { mutateAsync: requestPolicy } = policyRequest;

  const selectController = React.useCallback(
    async (next: Controller) => {
      await requestController(next).catch(ignore);
    },
    [requestController],
  );

  const selectPolicy = React.useCallback(
    async (next: Policy) => {
      await requestPolicy(next).catch(ignore);
    },
    [requestPolicy],
  );

  // One busy flag and error line for two rows never pressed at once.
  const write = writeState([controllerRequest, policyRequest]);

  return {
    controller,
    policy: pendingPolicy ?? reportedPolicy,
    pendingPolicy,
    busy: write.busy,
    error: write.error,
    selectController,
    selectPolicy,
  };
}
