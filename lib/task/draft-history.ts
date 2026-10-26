// The task editor's undo history: what one entry holds, and when a keystroke
// joins the entry before it rather than starting its own.
//
// An entry is the whole step list and map choice either side of the edit, not
// a diff: a draft is a few dozen small rows, and a snapshot cannot drift from
// the list the way a replayed edit can. The name is left out; its field has
// the browser's own undo, and Escape restores the saved one.

import type { TaskDraft } from "@/lib/task/draft-store";

export type DraftContent = Pick<TaskDraft, "steps" | "chosenMap">;

export interface DraftEdit {
  before: DraftContent;
  after: DraftContent;
  /**
   * What was being typed into ("12:text"), or null for an edit that stands
   * alone: a press, a drag, a pick.
   */
  tag: string | null;
  /** When the entry was last extended, ms. */
  at: number;
}

/** Typing within this long of the last keystroke in the same field is one edit. */
export const DRAFT_EDIT_MERGE_MS = 1000;

/**
 * Whether an edit extends `last` rather than starting an entry: the same
 * field, typed into without a pause. Without it Undo after typing a line
 * would take it back a letter at a time.
 */
export function mergesWith(last: DraftEdit | undefined, tag: string | null, now: number): boolean {
  return (
    last !== undefined &&
    tag !== null &&
    last.tag === tag &&
    now - last.at < DRAFT_EDIT_MERGE_MS
  );
}

export function draftContent(draft: TaskDraft): DraftContent {
  return { steps: draft.steps, chosenMap: draft.chosenMap };
}

/** Whether an edit changed anything Undo restores. */
export function contentChanged(before: TaskDraft, after: TaskDraft): boolean {
  return before.steps !== after.steps || before.chosenMap !== after.chosenMap;
}
