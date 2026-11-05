"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { normalizeTheta } from "@/lib/angle";
import { previewRoute, type GoalPose, type RoutePreview } from "@/lib/api/task";

export interface RoutePreviewState {
  /** The goal aimed for this preview; null when there is none. */
  goal: GoalPose | null;
  /** The planner's answer for `goal`, once it has one. */
  preview: RoutePreview | null;
  pending: boolean;
  /** No answer to give (no planner, another map, a newer preview): the backend's sentence. */
  error: string | null;
  request: (goal: GoalPose) => void;
  clear: () => void;
}

/**
 * Ask the planner what route a goal would take, without sending the robot.
 *
 * A mutation because it is a POST the operator triggers, but it answers to
 * nothing: it moves nothing and changes no resource, so it invalidates no
 * key, needs no reader and is not held by the emergency stop. Everything it
 * shows is the mutation's own state. That is also what keeps an aim followed
 * by a quicker second aim honest: the observer follows the latest call, so a
 * slow answer for the first goal never lands over the second's.
 */
export function useRoutePreview(mapName: string | null): RoutePreviewState {
  const mutation = useMutation({
    mutationFn: (goal: GoalPose) => previewRoute(goal, mapName),
  });
  const { mutate, reset, variables, data, isPending, error } = mutation;

  const request = React.useCallback(
    (goal: GoalPose) => mutate({ ...goal, theta: normalizeTheta(goal.theta) }),
    [mutate],
  );

  return {
    goal: variables ?? null,
    preview: data ?? null,
    pending: isPending,
    error: error?.message ?? null,
    request,
    clear: reset,
  };
}
