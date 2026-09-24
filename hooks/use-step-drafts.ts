"use client";

import * as React from "react";

import {
  moveStep,
  newStepDraft,
  type StepDraft,
} from "@/lib/task/step";
import type { StepType } from "@/lib/api/task";

export interface StepDrafts {
  steps: StepDraft[];
  /** Returns the new row's key, so the list can unfold the row it just added. */
  add: (type: StepType) => number;
  remove: (key: number) => void;
  /**
   * Take the row out and put it back at `index` (0-based), shifting the rows in
   * between. An out-of-range index is a no-op, so "up" on the first row and
   * "down" on the last need no guard at the call site.
   */
  moveTo: (key: number, index: number) => void;
  patch: (key: number, changes: Partial<Omit<StepDraft, "key">>) => void;
  /**
   * Swap the whole list, for loading a template into the editor.
   *
   * The drafts must be freshly built (via `fromTemplateSteps`, which calls
   * `newStepDraft`) rather than reused, so every row arrives with a key that has
   * never been mounted — otherwise React would reconcile the incoming rows into
   * the outgoing ones and carry over the focused input.
   */
  replace: (drafts: StepDraft[]) => void;
  clear: () => void;
}

/**
 * The step list an operator is authoring. Pure state — no network, no error, no
 * busy flag.
 *
 * Kept apart from useTaskDispatch because the schedule path sends the identical
 * list and has nothing to do with task tracking: one combined hook would carry a
 * `taskStatus` into a schedule footer that has no status to show.
 *
 * Reordering is drag-and-drop on a per-row handle, with a row menu for the
 * one-click jumps (top, bottom, one either way). It used to be two neighbour-swap
 * buttons on the assumption that a task is three to six rows; patrol templates
 * run to twenty and beyond, and fifteen clicks to make step 16 the first one is
 * not an edit anyone should have to make. Every gesture lands here as one
 * `moveTo`, so the hook knows nothing about how the operator asked for it.
 */
export function useStepDrafts(): StepDrafts {
  const [steps, setSteps] = React.useState<StepDraft[]>([]);

  const add = React.useCallback((type: StepType) => {
    // Built outside the updater so the key returned is the key stored: an
    // updater may run twice in development, and each run would mint its own.
    const draft = newStepDraft(type);
    setSteps((current) => [...current, draft]);
    return draft.key;
  }, []);

  const remove = React.useCallback((key: number) => {
    setSteps((current) => current.filter((step) => step.key !== key));
  }, []);

  const moveTo = React.useCallback((key: number, index: number) => {
    setSteps((current) =>
      moveStep(
        current,
        current.findIndex((step) => step.key === key),
        index,
      ),
    );
  }, []);

  /**
   * One addressed setter rather than a setter per field, because picking a vertex
   * writes four fields at once (x, y, theta and the provenance id) and that has
   * to be a single state update — two updates would render a frame whose numbers
   * are the new vertex's but whose provenance label is still the old one.
   */
  const patch = React.useCallback(
    (key: number, changes: Partial<Omit<StepDraft, "key">>) => {
      setSteps((current) =>
        current.map((step) => (step.key === key ? { ...step, ...changes } : step)),
      );
    },
    [],
  );

  const replace = React.useCallback((drafts: StepDraft[]) => setSteps(drafts), []);

  const clear = React.useCallback(() => setSteps([]), []);

  return { steps, add, remove, moveTo, patch, replace, clear };
}
