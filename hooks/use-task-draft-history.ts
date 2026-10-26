"use client";

import * as React from "react";

import { useUndoHistory } from "@/hooks/use-undo-history";
import type { TaskDraft } from "@/lib/task/draft-store";
import {
  contentChanged,
  draftContent,
  mergesWith,
  type DraftEdit,
} from "@/lib/task/draft-history";

export interface TaskDraftHistory {
  /**
   * Change the draft and record it. `tag` names a field being typed into, so
   * a burst of keystrokes is one entry (mergesWith).
   */
  edit: (change: (draft: TaskDraft) => TaskDraft, tag?: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo and Redo over the task editor's steps and map choice, on the map
 * editors' stack (lib/map/patch.ts), counted by entries rather than bytes.
 * It lives as long as the editor is mounted: a trip to another screen ends
 * it, as it does the map editors'.
 */
export function useTaskDraftHistory(
  update: (change: (draft: TaskDraft) => TaskDraft) => void,
): TaskDraftHistory {
  const history = useUndoHistory<DraftEdit>(() => 1);
  const { stack, push, pop } = history;

  const edit = React.useCallback(
    (change: (draft: TaskDraft) => TaskDraft, tag: string | null = null) => {
      update((current) => {
        const next = change(current);
        if (!contentChanged(current, next)) return next;
        const now = Date.now();
        const last = stack.undo[stack.undo.length - 1];
        if (stack.redo.length === 0 && mergesWith(last, tag, now)) {
          last!.after = draftContent(next);
          last!.at = now;
        } else {
          push({ before: draftContent(current), after: draftContent(next), tag, at: now });
        }
        return next;
      });
    },
    [update, stack, push],
  );

  const apply = React.useCallback(
    (direction: "undo" | "redo") => {
      const entry = pop(direction);
      if (!entry) return;
      const content = direction === "undo" ? entry.before : entry.after;
      update((current) => ({ ...current, ...content }));
    },
    [pop, update],
  );

  const undo = React.useCallback(() => apply("undo"), [apply]);
  const redo = React.useCallback(() => apply("redo"), [apply]);

  return { edit, undo, redo, canUndo: history.canUndo, canRedo: history.canRedo };
}
