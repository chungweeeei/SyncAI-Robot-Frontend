// The task editor's unsaved work, kept across a trip to another screen.
//
// The App Router unmounts /tasks on navigation, so without this an operator
// who left to place the waypoint their job was missing came back to an empty
// editor. The draft lives in sessionStorage: it survives a reload and a walk
// to the map editor, is private to the tab, and goes away when the tab does —
// which is exactly the lifetime of "the job I have not saved yet".
//
// A store with `subscribe` / `getSnapshot` rather than state restored in an
// effect, because /tasks is server-rendered: the first client render has to
// match the server's (which knows nothing), and the only sanctioned way to
// swap in a browser-side value after that is useSyncExternalStore — the same
// construction as useBrowserTimeZone. Restoring in an effect would be a
// synchronous setState the compiler lint rejects, and a flash of an empty
// editor besides.
//
// Storage is injected, never touched at module level: this runs on the server
// too, tests hand it a Map, and every real access is wrapped — a private
// window, blocked site data or a full quota must cost the cache, not /tasks.

import { z } from "zod";

import { reissueStepKeys, type StepDraft } from "@/lib/task/step";

export type TaskEditorMode = "now" | "schedule";

/** Everything the editor holds that is not yet on the robot. */
export interface TaskDraft {
  steps: StepDraft[];
  /** The template loaded in the editor, or null when authoring fresh. */
  editing: { id: string; name: string } | null;
  /** The operator's map override; null follows the loaded map. */
  chosenMap: string | null;
  composerOpen: boolean;
  mode: TaskEditorMode;
  /** The Save field, as typed — a half-named job is still the operator's work. */
  name: string;
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  steps: [],
  editing: null,
  chosenMap: null,
  composerOpen: false,
  mode: "now",
  name: "",
};

/** Nothing worth keeping: the entry is removed rather than written empty. */
export function isEmptyTaskDraft(draft: TaskDraft): boolean {
  return (
    draft.steps.length === 0 &&
    draft.editing === null &&
    draft.chosenMap === null &&
    draft.name === "" &&
    !draft.composerOpen &&
    draft.mode === "now"
  );
}

// Mirrors TaskDraft so a field added there and forgotten here fails to
// compile — the same reason the wire schemas carry the annotation. Unknown
// keys are stripped, so a draft written by a newer build still restores.
const StepDraftSchema: z.ZodType<StepDraft> = z.object({
  key: z.number(),
  type: z.enum(["MOVE", "SPEAK", "STANDUP", "LIEDOWN"]),
  x: z.string(),
  y: z.string(),
  theta: z.string(),
  text: z.string(),
  vertexId: z.string().nullable(),
  vertexMissing: z.boolean().optional(),
});

const TaskDraftSchema: z.ZodType<TaskDraft> = z.object({
  steps: z.array(StepDraftSchema),
  editing: z.object({ id: z.string(), name: z.string() }).nullable(),
  chosenMap: z.string().nullable(),
  composerOpen: z.boolean(),
  mode: z.enum(["now", "schedule"]),
  name: z.string(),
});

/**
 * What storage holds, or the empty draft when it holds nothing usable.
 *
 * Anything that does not parse is treated as nothing: a draft from a build
 * with a different shape is not worth a broken editor. The step keys are
 * re-minted on the way in — see `reissueStepKeys` on why the stored ones
 * cannot be trusted after a reload.
 */
export function decodeTaskDraft(raw: string | null): TaskDraft {
  if (raw === null) return EMPTY_TASK_DRAFT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_TASK_DRAFT;
  }
  const result = TaskDraftSchema.safeParse(parsed);
  if (!result.success) return EMPTY_TASK_DRAFT;
  return { ...result.data, steps: reissueStepKeys(result.data.steps) };
}

/** The subset of the Storage API this store needs, so a test can pass a Map. */
export interface DraftStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface TaskDraftStore {
  /** The current draft; the same object until `update` or `clear` runs. */
  getSnapshot: () => TaskDraft;
  subscribe: (listener: () => void) => () => void;
  update: (change: (draft: TaskDraft) => TaskDraft) => void;
  clear: () => void;
}

export const TASK_DRAFT_KEY = "tasks.draft";

export function createTaskDraftStore(
  storage: DraftStorage | null,
  key: string = TASK_DRAFT_KEY,
): TaskDraftStore {
  const listeners = new Set<() => void>();

  // Read once, up front, and never again: the snapshot is the truth from here
  // on and storage is only a mirror of it. Reading on every getSnapshot would
  // hand React a fresh object each call and loop it.
  let snapshot: TaskDraft = decodeTaskDraft(read());

  function read(): string | null {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(draft: TaskDraft): void {
    if (!storage) return;
    try {
      if (isEmptyTaskDraft(draft)) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(draft));
    } catch {
      // Quota, a private window, blocked site data: the editor keeps working
      // on the in-memory draft and simply stops surviving a reload.
    }
  }

  function set(next: TaskDraft): void {
    if (next === snapshot) return;
    snapshot = next;
    write(next);
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (change) => set(change(snapshot)),
    clear: () => set(EMPTY_TASK_DRAFT),
  };
}
