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

// Mirrors TaskDraft so a field added there and forgotten here fails to
// compile — the same reason the wire schemas carry the annotation. Unknown
// keys are stripped, so a draft written by a newer build still restores.
const StepDraftSchema: z.ZodType<StepDraft> = z.object({
  key: z.number(),
  type: z.enum(["MOVE", "SPEAK", "WAIT", "STANDUP", "LIEDOWN"]),
  x: z.string(),
  y: z.string(),
  theta: z.string(),
  text: z.string(),
  // Defaulted rather than required: it arrived with WAIT, and a draft saved by
  // a build from before that has no WAIT row to need it — refusing the whole
  // draft over it would cost the operator steps that are all still valid.
  seconds: z.string().default(""),
  vertexId: z.string().nullable(),
  vertexMissing: z.boolean().optional(),
  // Defaulted for the reason `seconds` is: a draft from before groups has
  // every row on its own, which is exactly what false says.
  withPrevious: z.boolean().default(false),
});

const TaskDraftSchema: z.ZodType<TaskDraft> = z.object({
  steps: z.array(StepDraftSchema),
  editing: z.object({ id: z.string(), name: z.string() }).nullable(),
  chosenMap: z.string().nullable(),
  name: z.string(),
});

/**
 * A template opened in the editor, as a whole draft.
 *
 * `fromTemplateSteps` reads resolved_params, so a vertex moved since the save
 * shows its *current* pose, and it mints fresh keys, so no incoming row is
 * reconciled into an outgoing one. A template for another map opens on that
 * map; one with no Move step names none and leaves the current choice alone.
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
 * A Move bound to a waypoint is that waypoint and nothing else: its numbers
 * are re-resolved from the waypoint's current pose on every load, so a
 * waypoint moved on the map since this draft was opened must not read as an
 * edit the operator made. Only the fields a type actually saves count — a row
 * switched from Move to Speak keeps its stale coordinates in the draft.
 */
function stepFingerprint(step: StepDraft, index: number): string {
  // The link counts: running a step alongside another changes the job as much
  // as editing it. Not on the first row, where a link means nothing.
  return `${index > 0 && step.withPrevious ? "&" : ""}${stepContent(step)}`;
}

function stepContent(step: StepDraft): string {
  switch (step.type) {
    case "MOVE":
      return step.vertexId !== null
        ? `MOVE@${step.vertexId}`
        : `MOVE ${step.x} ${step.y} ${step.theta}`;
    case "SPEAK":
      // Trimmed because Save trims: trailing spaces are not a change to the job.
      return `SPEAK ${step.text.trim()}`;
    case "WAIT":
      return `WAIT ${step.seconds}`;
    default:
      return step.type;
  }
}

/**
 * Whether the draft holds work that is not on the robot.
 *
 * A fresh job is unsaved as soon as it has a step or a name. A loaded one is
 * unsaved only once it differs from the stored row — steps, name or map — so
 * opening a job and walking away is not reported as work at risk. Asking
 * about nothing trains the operator to press OK, and then the one confirm
 * that guards real work is pressed through too.
 *
 * `templates` is the library as read; a loaded row it does not hold (still
 * loading, deleted elsewhere) cannot be compared against and counts as
 * unsaved, since a false alarm costs a click and a missed one costs the job.
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
 * job) would throw away unsaved work. The editor is a page of its own now, so
 * the draft is off-screen whenever this is asked: replacing it silently would
 * be data loss nobody saw happen. Reopening the template that is already
 * loaded is not a replacement.
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
