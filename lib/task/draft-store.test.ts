import { describe, expect, it } from "vitest";

import {
  EMPTY_TASK_DRAFT,
  TASK_DRAFT_KEY,
  createTaskDraftStore,
  decodeTaskDraft,
  draftFromTemplate,
  draftIsUnsaved,
  draftWouldBeLost,
  isEmptyTaskDraft,
  type DraftStorage,
  type TaskDraft,
} from "@/lib/task/draft-store";
import type { TaskTemplate } from "@/lib/api/task-template";
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
    expect(decodeTaskDraft(JSON.stringify({ ...draft(), name: undefined }))).toBe(
      EMPTY_TASK_DRAFT,
    );
  });

  it("round-trips everything but the step keys", () => {
    const stored = draft();
    const restored = decodeTaskDraft(JSON.stringify(stored));
    expect(restored.editing).toEqual(stored.editing);
    expect(restored.chosenMap).toBe("wh1");
    expect(restored.name).toBe("night run");
    expect(restored.steps.map(withoutKey)).toEqual(stored.steps.map(withoutKey));
  });

  it("still restores a draft written by an older editor", () => {
    // Older builds stored `composerOpen` (the fold) and `mode` (Run now or
    // On a schedule); an unknown key is stripped rather than costing the
    // operator their steps.
    const restored = decodeTaskDraft(
      JSON.stringify({ ...draft(), composerOpen: true, mode: "schedule" }),
    );
    expect(restored.name).toBe("night run");
    expect(restored).not.toHaveProperty("composerOpen");
    expect(restored).not.toHaveProperty("mode");
  });

  it("still restores a draft saved before the duration field existed", () => {
    // `seconds` arrived with WAIT; a draft from before it has no WAIT row,
    // and losing all of its steps over a field none of them use would be
    // the wrong trade.
    const stored = draft();
    const old = {
      ...stored,
      steps: stored.steps.map((step) => {
        const { seconds, ...rest } = step;
        void seconds;
        return rest;
      }),
    };
    const restored = decodeTaskDraft(JSON.stringify(old));
    expect(restored.steps).toHaveLength(2);
    expect(restored.steps.every((step) => step.seconds === "")).toBe(true);
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
      store.update((current) => ({ ...current, name: "x" }));
      expect(store.getSnapshot().name).toBe("x");
      store.clear();
      expect(store.getSnapshot()).toBe(EMPTY_TASK_DRAFT);
    }
  });
});

function template(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: "t2",
    name: "Dock check",
    description: "",
    map_name: "wh2",
    steps: [
      {
        id: "s1",
        type: "SPEAK",
        params: { text: "hello" },
        resolved_params: { text: "hello" },
        vertex_id: null,
        vertex_name: null,
        vertex_status: "NONE",
      },
    ],
    map_matches_active: true,
    missing_vertex_count: 0,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("draftFromTemplate", () => {
  it("opens the template on its own map, named", () => {
    const next = draftFromTemplate(draft(), template());
    expect(next.editing).toEqual({ id: "t2", name: "Dock check" });
    expect(next.name).toBe("Dock check");
    expect(next.chosenMap).toBe("wh2");
    expect(next.steps.map((step) => step.text)).toEqual(["hello"]);
  });

  it("leaves the map choice alone for a template that names none", () => {
    expect(draftFromTemplate(draft(), template({ map_name: null })).chosenMap).toBe(
      "wh1",
    );
  });
});

/** A stored job with a waypoint Move and a Speak, as the library lists it. */
function savedRound(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return template({
    id: "t1",
    name: "Morning round",
    map_name: "wh1",
    steps: [
      {
        id: "s1",
        type: "MOVE",
        params: { x: 1, y: 2, theta: 0 },
        resolved_params: { x: 1, y: 2, theta: 0 },
        vertex_id: "v1",
        vertex_name: "Dock",
        vertex_status: "CURRENT",
      },
      {
        id: "s2",
        type: "SPEAK",
        params: { text: "arrived" },
        resolved_params: { text: "arrived" },
        vertex_id: null,
        vertex_name: null,
        vertex_status: "NONE",
      },
    ],
    ...over,
  });
}

describe("draftIsUnsaved", () => {
  const library = [savedRound()];
  const opened = () => draftFromTemplate(EMPTY_TASK_DRAFT, savedRound());

  it("counts a fresh job with a step or only a name, and not an empty one", () => {
    const fresh = { ...EMPTY_TASK_DRAFT, chosenMap: "wh1" };
    expect(draftIsUnsaved(fresh, library)).toBe(false);
    expect(draftIsUnsaved({ ...fresh, name: "  " }, library)).toBe(false);
    expect(draftIsUnsaved({ ...fresh, name: "night run" }, library)).toBe(true);
    expect(draftIsUnsaved({ ...fresh, steps: [newStepDraft("SPEAK")] }, library)).toBe(true);
  });

  it("does not count a saved job opened and left as it was", () => {
    expect(draftIsUnsaved(opened(), library)).toBe(false);
  });

  it("does not count a waypoint moved on the map since the job was opened", () => {
    // The load re-resolves the Move from the waypoint's current pose; the
    // operator changed nothing, so nothing of theirs is at risk.
    const moved = savedRound();
    moved.steps[0] = {
      ...moved.steps[0],
      resolved_params: { x: 5, y: 6, theta: 90 },
    } as TaskTemplate["steps"][number];
    expect(draftIsUnsaved(opened(), [moved])).toBe(false);
  });

  it("counts an edit to the steps, the name or the map", () => {
    const base = opened();
    const [move, speak] = base.steps;
    expect(draftIsUnsaved({ ...base, name: "Evening round" }, library)).toBe(true);
    expect(draftIsUnsaved({ ...base, chosenMap: "wh2" }, library)).toBe(true);
    expect(draftIsUnsaved({ ...base, steps: [move] }, library)).toBe(true);
    expect(draftIsUnsaved({ ...base, steps: [speak, move] }, library)).toBe(true);
    expect(
      draftIsUnsaved({ ...base, steps: [move, { ...speak, text: "here" }] }, library),
    ).toBe(true);
    expect(
      draftIsUnsaved({ ...base, steps: [{ ...move, vertexId: "v2" }, speak] }, library),
    ).toBe(true);
  });

  it("does not count whitespace Save would trim", () => {
    const base = opened();
    const [move, speak] = base.steps;
    expect(
      draftIsUnsaved(
        { ...base, name: "Morning round ", steps: [move, { ...speak, text: "arrived  " }] },
        library,
      ),
    ).toBe(false);
  });

  it("counts a loaded job the library cannot vouch for", () => {
    // Still loading, or deleted from another console: a false alarm costs a
    // click, a missed one costs the job.
    expect(draftIsUnsaved(opened(), null)).toBe(true);
    expect(draftIsUnsaved(opened(), [])).toBe(true);
  });
});

describe("draftWouldBeLost", () => {
  const library = [savedRound()];

  it("is false for an empty editor, whatever replaces it", () => {
    expect(draftWouldBeLost(EMPTY_TASK_DRAFT, null, library)).toBe(false);
    expect(draftWouldBeLost(EMPTY_TASK_DRAFT, "t2", library)).toBe(false);
  });

  it("is true when unsaved work would be replaced by a new job or another template", () => {
    expect(draftWouldBeLost(draft(), null, library)).toBe(true);
    expect(draftWouldBeLost(draft(), "t2", library)).toBe(true);
    expect(draftWouldBeLost(draft({ editing: null }), "t1", library)).toBe(true);
  });

  it("is false when the loaded job is unchanged, so nothing is lost", () => {
    const opened = draftFromTemplate(EMPTY_TASK_DRAFT, savedRound());
    expect(draftWouldBeLost(opened, null, library)).toBe(false);
    expect(draftWouldBeLost(opened, "t2", library)).toBe(false);
  });

  it("is false when reopening the template already loaded", () => {
    expect(draftWouldBeLost(draft(), "t1", library)).toBe(false);
  });
});
