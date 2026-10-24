"use client";

import * as React from "react";

import {
  moveStepDraft,
  newStepDraft,
  stepPatchFromVertex,
  stepTypeForVertex,
  unlinkStep,
  type StepDraft,
} from "@/lib/task/step";
import type { StepType } from "@/lib/api/task";
import type { MapVertex } from "@/lib/types/map";

export interface StepDrafts {
  steps: StepDraft[];
  /** Returns the new row's key, so the list can unfold the row it just added. */
  add: (type: StepType) => number;
  /** Append a row already set to a waypoint (see stepTypeForVertex); returns its key. */
  addFromVertex: (vertex: MapVertex) => number;
  /** Take the row out; the rows it ran with stay linked (see unlinkStep). */
  remove: (key: number) => void;
  /**
   * Move the row to `index` (0-based). Out of range is a no-op, so callers
   * need no guard. Where it lands decides its group: see moveStepDraft.
   */
  moveTo: (key: number, index: number) => void;
  patch: (key: number, changes: Partial<Omit<StepDraft, "key">>) => void;
  /** A box's Ungroup: each of these rows starts after the row above it. */
  ungroup: (keys: readonly number[]) => void;
  /**
   * Swap the whole list. The drafts must be freshly built (`fromTemplateSteps`)
   * so their keys were never mounted, or React would carry the focused input
   * over into the incoming rows.
   */
  replace: (drafts: StepDraft[]) => void;
  clear: () => void;
}

/**
 * Pure edits over the step list being authored — no network.
 *
 * The list lives in the task draft (use-task-draft.ts), passed in so a trip to
 * the map editor and back keeps the rows. Apart from useTaskDispatch because
 * the schedule path sends the same list with no tracking. Every reorder
 * gesture lands as one `moveTo`.
 */
export function useStepDrafts(
  steps: StepDraft[],
  setSteps: (change: (current: StepDraft[]) => StepDraft[]) => void,
): StepDrafts {

  const add = React.useCallback(
    (type: StepType) => {
      // Outside the updater, which may run twice in development and mint two keys.
      const draft = newStepDraft(type);
      setSteps((current) => [...current, draft]);
      return draft.key;
    },
    [setSteps],
  );

  const addFromVertex = React.useCallback(
    (vertex: MapVertex) => {
      const draft = { ...newStepDraft(stepTypeForVertex(vertex)), ...stepPatchFromVertex(vertex) };
      setSteps((current) => [...current, draft]);
      return draft.key;
    },
    [setSteps],
  );

  const remove = React.useCallback(
    (key: number) => {
      setSteps((current) => {
        const index = current.findIndex((step) => step.key === key);
        if (index === -1) return current;
        return unlinkStep(current, index).filter((step) => step.key !== key);
      });
    },
    [setSteps],
  );

  const moveTo = React.useCallback(
    (key: number, index: number) => {
      setSteps((current) => {
        const from = current.findIndex((step) => step.key === key);
        // A drop back where it started must stay a no-op, not a quiet unlink.
        if (from === index || from === -1 || index < 0 || index >= current.length) {
          return current;
        }
        return moveStepDraft(current, from, index);
      });
    },
    [setSteps],
  );

  const ungroup = React.useCallback(
    (keys: readonly number[]) => {
      setSteps((current) =>
        current.map((step) =>
          keys.includes(step.key) && step.withPrevious ? { ...step, withPrevious: false } : step,
        ),
      );
    },
    [setSteps],
  );

  /**
   * One setter for several fields: picking a vertex writes x, y, theta and the
   * provenance id in one update, or a frame would mix old and new.
   */
  const patch = React.useCallback(
    (key: number, changes: Partial<Omit<StepDraft, "key">>) => {
      setSteps((current) =>
        current.map((step) => (step.key === key ? { ...step, ...changes } : step)),
      );
    },
    [setSteps],
  );

  const replace = React.useCallback(
    (drafts: StepDraft[]) => setSteps(() => drafts),
    [setSteps],
  );

  const clear = React.useCallback(() => setSteps(() => []), [setSteps]);

  return { steps, add, addFromVertex, remove, moveTo, patch, ungroup, replace, clear };
}
