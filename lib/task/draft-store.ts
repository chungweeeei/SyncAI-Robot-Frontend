// The task editor's unsaved work, kept across a trip to another screen.
//
// sessionStorage matches the lifetime of "the job I have not saved yet": it
// survives a reload and a walk to the map editor, is private to the tab, and
// ends with it. A `subscribe` / `getSnapshot` store for useSyncExternalStore,
// not an effect restore, because the page is server-rendered and the first
// client render must match the server's.
//
// Storage is injected (the server has none, tests pass a Map) and every access
// is wrapped: a private window or full quota must cost the cache, not /tasks.

import { z } from "zod";

import type { TaskTemplate } from "@/lib/api/task-template";
import { fromTemplateSteps, reissueStepKeys, type StepDraft } from "@/lib/task/step";

/** Everything the editor holds that is not yet on the robot. */
export interface TaskDraft {
  steps: StepDraft[];
  /** The template loaded in the editor, or null when authoring fresh. */
  editing: { id: string; name: string } | null;
  /** The operator's map override; null follows the loaded map. */
  chosenMap: string | null;
  /** The heading's name field, as typed — a half-named job is still the operator's work. */
  name: string;
}

export const EMPTY_TASK_DRAFT: TaskDraft = {
  steps: [],
  editing: null,
  chosenMap: null,
  name: "",
};

/** Nothing worth keeping: the entry is removed rather than written empty. */
export function isEmptyTaskDraft(draft: TaskDraft): boolean {
  return (
    draft.steps.length === 0 &&
    draft.editing === null &&
    draft.chosenMap === null &&
    draft.name === ""
  );
}

// Annotated so a TaskDraft field forgotten here fails to compile. Unknown keys
// are stripped, so a draft written by a newer build still restores.
const StepDraftSchema: z.ZodType<StepDraft> = z.object({
  key: z.number(),
  type: z.enum(["MOVE", "DOCK", "SPEAK", "WAIT", "STANDUP", "LIEDOWN"]),
  x: z.string(),
  y: z.string(),
  theta: z.string(),
  text: z.string(),
  // Defaulted, not required: a draft from before WAIT has no row that needs
  // it, and refusing the whole draft would cost steps that are still valid.
  seconds: z.string().default(""),
  // Defaulted likewise: a draft from before the count says every line once.
  repeat: z.string().default("1"),
  vertexId: z.string().nullable(),
  vertexMissing: z.boolean().optional(),
  // Defaulted likewise: a draft from before groups has every row on its own.
  withPrevious: z.boolean().default(false),
});

const TaskDraftSchema: z.ZodType<TaskDraft> = z.object({
  steps: z.array(StepDraftSchema),
  editing: z.object({ id: z.string(), name: z.string() }).nullable(),
  chosenMap: z.string().nullable(),
  name: z.string(),
});

/**
 * A template opened in the editor, as a whole draft. Steps come from
 * resolved_params (a moved vertex shows its *current* pose) with fresh keys.
 * A template with no Move names no map and leaves the current choice alone.
 */
export function draftFromTemplate(current: TaskDraft, template: TaskTemplate): TaskDraft {
  return {
    steps: fromTemplateSteps(template.steps),
    editing: { id: template.id, name: template.name },
    chosenMap: template.map_name ?? current.chosenMap,
    name: template.name,
  };
}

/**
 * What a step would save as, for telling an edited row from a loaded one.
 *
 * A Move bound to a waypoint is that waypoint alone: its numbers re-resolve on
 * every load, so a waypoint moved on the map must not read as the operator's
 * edit. Only the fields a type saves count — a row switched from Move to Speak
 * keeps stale coordinates in the draft.
 */
function stepFingerprint(step: StepDraft, index: number): string {
  // The link counts as an edit, except on the first row where it means nothing.
  return `${index > 0 && step.withPrevious ? "&" : ""}${stepContent(step)}`;
}

function stepContent(step: StepDraft): string {
  switch (step.type) {
    case "MOVE":
    case "DOCK":
      // The type leads, so a Move switched to a Dock on the same waypoint is an edit.
      return step.vertexId !== null
        ? `${step.type}@${step.vertexId}`
        : `${step.type} ${step.x} ${step.y} ${step.theta}`;
    case "SPEAK":
      // Trimmed because Save trims: trailing spaces are not a change to the job.
      return `SPEAK ${step.repeat.trim()} ${step.text.trim()}`;
    case "WAIT":
      return `WAIT ${step.seconds}`;
    default:
      return step.type;
  }
}

/**
 * Whether the draft holds work that is not on the robot.
 *
 * A fresh job is unsaved once it has a step or a name; a loaded one only once
 * it differs from the stored row. Asking about nothing trains the operator to
 * press OK through the one confirm that guards real work.
 *
 * A loaded row missing from `templates` (still loading, deleted elsewhere)
 * counts as unsaved: a false alarm costs a click, a missed one the job.
 */
export function draftIsUnsaved(
  draft: TaskDraft,
  templates: readonly TaskTemplate[] | null,
): boolean {
  if (draft.editing === null) {
    return draft.steps.length > 0 || draft.name.trim() !== "";
  }
  const editingId = draft.editing.id;
  const saved = templates?.find((template) => template.id === editingId);
  if (!saved) return true;
  if (draft.name.trim() !== saved.name) return true;
  if (saved.map_name !== null && draft.chosenMap !== saved.map_name) return true;
  const savedSteps = fromTemplateSteps(saved.steps);
  return (
    draft.steps.length !== savedSteps.length ||
    draft.steps.some(
      (step, index) =>
        stepFingerprint(step, index) !== stepFingerprint(savedSteps[index]!, index),
    )
  );
}

/**
 * Whether replacing the draft with `templateId` (or with nothing, for a new
 * job) would throw away unsaved work. The draft is off-screen whenever this is
 * asked, so a silent replace would be loss nobody saw. Reopening the loaded
 * template is not a replacement.
 */
export function draftWouldBeLost(
  draft: TaskDraft,
  templateId: string | null,
  templates: readonly TaskTemplate[] | null,
): boolean {
  if (templateId !== null && draft.editing?.id === templateId) return false;
  return draftIsUnsaved(draft, templates);
}

/**
 * What storage holds, or the empty draft when it holds nothing usable — a
 * draft of another shape is not worth a broken editor. Step keys are re-minted
 * (see `reissueStepKeys`).
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

  // Read once: from here on storage only mirrors the snapshot. Reading on every
  // getSnapshot would hand React a fresh object each call and loop it.
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
      // Quota, private window, blocked site data: the in-memory draft still
      // works, it just stops surviving a reload.
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
