import { describe, expect, it } from "vitest";

import { EMPTY_TASK_DRAFT } from "@/lib/task/draft-store";
import {
  DRAFT_EDIT_MERGE_MS,
  contentChanged,
  mergesWith,
  type DraftEdit,
} from "@/lib/task/draft-history";
import { newStepDraft } from "@/lib/task/step";

function entry(tag: string | null, at: number): DraftEdit {
  const content = { steps: [], chosenMap: null };
  return { before: content, after: content, tag, at };
}

describe("mergesWith", () => {
  it("joins typing into the same field without a pause", () => {
    expect(mergesWith(entry("3:text", 1000), "3:text", 1000 + DRAFT_EDIT_MERGE_MS - 1)).toBe(true);
  });

  // Undo after a pause takes back the last burst, not the whole line.
  it("starts a new entry after a pause, in another field, or for a press", () => {
    expect(mergesWith(entry("3:text", 1000), "3:text", 1000 + DRAFT_EDIT_MERGE_MS)).toBe(false);
    expect(mergesWith(entry("3:text", 1000), "4:text", 1001)).toBe(false);
    expect(mergesWith(entry(null, 1000), null, 1001)).toBe(false);
    expect(mergesWith(undefined, "3:text", 1001)).toBe(false);
  });
});

describe("contentChanged", () => {
  it("ignores the name, which its own field undoes", () => {
    const draft = { ...EMPTY_TASK_DRAFT };
    expect(contentChanged(draft, { ...draft, name: "patrol" })).toBe(false);
    expect(contentChanged(draft, { ...draft, steps: [newStepDraft("WAIT")] })).toBe(true);
    expect(contentChanged(draft, { ...draft, chosenMap: "wh2" })).toBe(true);
  });
});
