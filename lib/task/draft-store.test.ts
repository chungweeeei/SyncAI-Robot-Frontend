import { describe, expect, it } from "vitest";

import {
  EMPTY_TASK_DRAFT,
  TASK_DRAFT_KEY,
  createTaskDraftStore,
  decodeTaskDraft,
  isEmptyTaskDraft,
  type DraftStorage,
  type TaskDraft,
} from "@/lib/task/draft-store";
import { newStepDraft, type StepDraft } from "@/lib/task/step";

/**
 * The rules the draft cache has to keep: what comes back from storage is
 * either a usable draft or nothing, never a half-one; restored rows never
 * share a key with a row added afterwards; and a storage that misbehaves
 * costs the cache, not the editor.
 */

function fakeStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function withoutKey(step: StepDraft): Omit<StepDraft, "key"> {
  const { key, ...rest } = step;
  void key;
  return rest;
}

function draft(over: Partial<TaskDraft> = {}): TaskDraft {
  return {
    ...EMPTY_TASK_DRAFT,
    steps: [{ ...newStepDraft("MOVE"), x: "1", y: "2", vertexId: "v1" }, newStepDraft("SPEAK")],
    editing: { id: "t1", name: "Morning round" },
    chosenMap: "wh1",
    composerOpen: true,
    name: "night run",
    ...over,
  };
}

describe("decodeTaskDraft", () => {
  it("returns the empty draft for nothing, garbage, or a shape it does not know", () => {
    expect(decodeTaskDraft(null)).toBe(EMPTY_TASK_DRAFT);
    expect(decodeTaskDraft("{not json")).toBe(EMPTY_TASK_DRAFT);
    expect(decodeTaskDraft(JSON.stringify({ steps: "nope" }))).toBe(EMPTY_TASK_DRAFT);
    // A required field missing is a draft from another build, not a draft.
    expect(decodeTaskDraft(JSON.stringify({ ...draft(), mode: undefined }))).toBe(
      EMPTY_TASK_DRAFT,
    );
  });

  it("round-trips everything but the step keys", () => {
    const stored = draft();
    const restored = decodeTaskDraft(JSON.stringify(stored));
    expect(restored.editing).toEqual(stored.editing);
    expect(restored.chosenMap).toBe("wh1");
    expect(restored.name).toBe("night run");
    expect(restored.composerOpen).toBe(true);
    expect(restored.steps.map(withoutKey)).toEqual(stored.steps.map(withoutKey));
  });

  it("re-mints every restored key so a row added next cannot collide", () => {
    // Keys as a previous page load minted them: low numbers the counter in
    // this module will reach again.
    const stored = draft({
      steps: [
        { ...newStepDraft("MOVE"), key: 1 },
        { ...newStepDraft("SPEAK"), key: 2 },
      ],
    });
    const restored = decodeTaskDraft(JSON.stringify(stored));
    const keys = restored.steps.map((step) => step.key);
    expect(new Set(keys).size).toBe(2);
    const added = newStepDraft("STANDUP");
    expect(keys).not.toContain(added.key);
    for (const key of keys) expect(key).toBeLessThan(added.key);
  });
});

describe("createTaskDraftStore", () => {
  it("starts from what storage holds", () => {
    const storage = fakeStorage();
    storage.map.set(TASK_DRAFT_KEY, JSON.stringify(draft()));
    const store = createTaskDraftStore(storage);
    expect(store.getSnapshot().name).toBe("night run");
  });

  it("writes each update through and notifies, and keeps one identity between them", () => {
    const storage = fakeStorage();
    const store = createTaskDraftStore(storage);
    let notified = 0;
    store.subscribe(() => (notified += 1));

    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);

    store.update((current) => ({ ...current, name: "night run" }));
    expect(notified).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(JSON.parse(storage.map.get(TASK_DRAFT_KEY)!).name).toBe("night run");
  });

  it("removes the entry rather than storing an empty draft", () => {
    const storage = fakeStorage();
    const store = createTaskDraftStore(storage);
    store.update((current) => ({ ...current, name: "x" }));
    expect(storage.map.has(TASK_DRAFT_KEY)).toBe(true);
    store.clear();
    expect(storage.map.has(TASK_DRAFT_KEY)).toBe(false);
    expect(isEmptyTaskDraft(store.getSnapshot())).toBe(true);
  });

  it("keeps working in memory when storage throws or is absent", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    for (const storage of [broken, null]) {
      const store = createTaskDraftStore(storage);
      expect(store.getSnapshot()).toBe(EMPTY_TASK_DRAFT);
      store.update((current) => ({ ...current, composerOpen: true }));
      expect(store.getSnapshot().composerOpen).toBe(true);
      store.clear();
      expect(store.getSnapshot()).toBe(EMPTY_TASK_DRAFT);
    }
  });
});
