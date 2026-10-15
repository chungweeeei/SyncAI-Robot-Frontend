// The step vocabulary and the draft model behind the /tasks composer, and the
// conversion to wire shape. One copy, because a dispatch and a schedule
// registration send the same list; lib/api/task.ts never sees a half-typed field.

import { normalizeTheta } from "@/lib/angle";
import type { TemplateStep, TemplateStepRequest } from "@/lib/api/task-template";
import type {
  MoveStepParams,
  NavStepType,
  StepType,
  TaskStepRequest,
  WaitStepParams,
} from "@/lib/api/task";

export interface StepTypeSpec {
  value: StepType;
  /** Condensed caps in the UI, so short. */
  label: string;
  /** One character in the row's leading column, mirroring the vertex glyphs. */
  glyph: string;
  /** One line under the add row, so the vocabulary is not guessed. */
  hint: string;
}

/** Order is the add row's order; the fillable steps first, the bare postures last. */
export const STEP_TYPES: readonly StepTypeSpec[] = [
  { value: "MOVE", label: "Move", glyph: "M", hint: "Drive to a pose in the map frame." },
  // Named for what the operator asks of the robot. The drive to the approach
  // point in front of the waypoint is part of it, and the hint says so.
  {
    value: "DOCK",
    label: "Dock",
    glyph: "D",
    hint: "Go to a waypoint, then walk straight onto the charger there and lie down.",
  },
  {
    value: "UNDOCK",
    label: "Undock",
    glyph: "U",
    hint: "Stand up and back straight off the charger to 1 m in front of it.",
  },
  // "T" (for TTS) because STANDUP already owns "S".
  { value: "SPEAK", label: "Speak", glyph: "T", hint: "Say a line on the robot speaker (TTS)." },
  // "Stay put", not "pause": Pause is the masthead's hold on a running job.
  { value: "WAIT", label: "Wait", glyph: "W", hint: "Stay put for a set time, then go on." },
  { value: "STANDUP", label: "Stand", glyph: "S", hint: "Stand up. Nothing to set." },
  { value: "LIEDOWN", label: "Lie", glyph: "L", hint: "Lie down. Nothing to set." },
];

/** Mirrors `SpeakParams.text`'s `max_length` — the backend 422s past this. */
export const SPEAK_TEXT_MAX = 1000;

/** Mirrors `SpeakParams.repeat`'s `le`: a typo must not keep the robot talking for an hour. */
export const SPEAK_REPEAT_MAX = 50;

/** Mirrors `WaitParams.seconds`' `le`: a typo must not park the robot for days. */
export const WAIT_SECONDS_MAX = 3600;

const GLYPHS: Record<StepType, string> = STEP_TYPES.reduce(
  (all, spec) => ({ ...all, [spec.value]: spec.glyph }),
  {} as Record<StepType, string>,
);

export function stepGlyph(type: StepType): string {
  return GLYPHS[type] ?? "?";
}

const NAV_STEP_TYPES: ReadonlySet<StepType> = new Set<NavStepType>(["MOVE", "DOCK", "UNDOCK"]);

/**
 * Whether a step is set by a waypoint: a Move, or either half of a dock. All
 * three carry a pose in the map's frame, follow a vertex once saved and tie
 * the job to its map; the backend's `NAV_STEP_TYPES`.
 */
export function isNavStep<T extends { type: StepType }>(
  step: T,
): step is T & { type: NavStepType } {
  return NAV_STEP_TYPES.has(step.type);
}

export interface StepDraft {
  /** Client-only identity: the React key, and what add / remove / move address. */
  key: number;
  type: StepType;
  /** MOVE / DOCK / UNDOCK only. Raw text — see parseCoordinate. */
  x: string;
  y: string;
  theta: string;
  /**
   * SPEAK only: what to say. Trimmed on the way out, not on change. Voice and
   * speed are deliberately not draft fields: the backend defaults them.
   */
  text: string;
  /** SPEAK only: how many times to say the text, as typed. Once sends no `repeat`. */
  repeat: string;
  /** WAIT only: the duration in seconds, as typed (see parseCoordinate). */
  seconds: string;
  /**
   * The vertex the numbers were prefilled from, or null once hand edited.
   * **Saving** sends it, so a stored MOVE or dock can follow its vertex; **dispatching**
   * never does — `POST /api/v1/tasks` has no notion of provenance.
   */
  vertexId: string | null;
  /**
   * Loaded from a template whose vertex has since been deleted: the coordinates
   * are the save-time snapshot. Display only; it does not block dispatch.
   */
  vertexMissing?: boolean;
  /**
   * Starts together with the row above. A link rather than a group name: the
   * backend only runs adjacent groups, and a chain of links cannot be anything
   * else. Names are minted on the way out (`stepGroupNames`). Ignored on the
   * first row.
   */
  withPrevious: boolean;
}

/**
 * A monotonic key per row. Not the positional `step.id` (see `stepIdFor`): as a
 * React key it would reconcile one row's DOM into another mid-reorder and the
 * focused input would jump.
 */
let nextKey = 0;

export function newStepDraft(type: StepType): StepDraft {
  nextKey += 1;
  // theta defaults to "0": a zero heading is a real answer, a position has no default.
  return {
    key: nextKey,
    type,
    x: "",
    y: "",
    theta: "0",
    text: "",
    repeat: "1",
    seconds: "",
    vertexId: null,
    withPrevious: false,
  };
}

/**
 * The same rows under keys minted now. For rows back from storage: the counter
 * restarts with the module, so stored keys would collide with the next row added.
 */
export function reissueStepKeys(drafts: readonly StepDraft[]): StepDraft[] {
  return drafts.map((draft) => ({ ...draft, key: newStepDraft(draft.type).key }));
}

/**
 * Render a stored number into a draft field.
 *
 * Wire doubles (`6.8344510000000005`) are unreadable in a narrow input. Rounding
 * does change what is dispatched, deliberately: what is in the box is exactly
 * what is sent. 1 mm and 0.1° are far below what the planner and gait track.
 * `Number(...)` drops the padding, so 0 reads "0", not "0.000".
 */
function formatDraftNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** Metres, to the millimetre. */
export function formatDraftPosition(value: number): string {
  return formatDraftNumber(value, 3);
}

/** Degrees, to a tenth. */
export function formatDraftAngle(value: number): string {
  return formatDraftNumber(value, 1);
}

/**
 * The one-line readback a folded row shows, or null when there is nothing to
 * say yet. Built from the draft's own text, so it reads exactly what was typed.
 * The waypoint name leads; the coordinates tell apart two that share a name.
 */
export function stepSummary(
  draft: StepDraft,
  waypointName: string | null = null,
): string | null {
  switch (draft.type) {
    case "MOVE":
    case "DOCK":
    case "UNDOCK": {
      const [x, y, theta] = [draft.x, draft.y, draft.theta].map((v) => v.trim());
      if (!x || !y || !theta) return null;
      const pose = `(${x}, ${y}) · ${theta}°`;
      return waypointName ? `${waypointName} · ${pose}` : pose;
    }
    case "SPEAK": {
      const text = draft.text.trim();
      return text ? `“${text}”${repeatSuffix(speakRepeat(draft) ?? 1)}` : null;
    }
    case "WAIT": {
      const seconds = draft.seconds.trim();
      return seconds ? `${seconds} s` : null;
    }
    default:
      return null;
  }
}

/**
 * Which waypoints the job goes to, as which steps: vertex id → the 1-based
 * ordinals of the rows picked from it (Move or dock), for the editor's floor
 * plan. A list because a patrol returns to `dock` ("steps 1, 4"). A
 * hand-edited row has no vertex and marks nothing.
 */
export function stepWaypointOrdinals(
  drafts: readonly StepDraft[],
): ReadonlyMap<string, readonly number[]> {
  const marks = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    if (!isNavStep(draft) || draft.vertexId === null) return;
    const ordinals = marks.get(draft.vertexId) ?? [];
    ordinals.push(index + 1);
    marks.set(draft.vertexId, ordinals);
  });
  return marks;
}

/**
 * The waypoints a dock row (either half) is picked on, for the floor plan to
 * draw the approach point in front of: the robot drives there before it walks
 * on or after it backs off, and that leg is not a row of its own.
 */
export function stepDockVertices(drafts: readonly StepDraft[]): ReadonlySet<string> {
  const docks = new Set<string>();
  for (const draft of drafts) {
    if ((draft.type === "DOCK" || draft.type === "UNDOCK") && draft.vertexId !== null) {
      docks.add(draft.vertexId);
    }
  }
  return docks;
}

/**
 * What a new Undock row starts with: the waypoint of the last Dock above it,
 * since a robot leaves the charger it docked on. Null when there is none to
 * copy, and the row starts blank like any other.
 */
export function undockDefaults(
  drafts: readonly StepDraft[],
): Pick<StepDraft, "x" | "y" | "theta" | "vertexId"> | null {
  const dock = drafts.findLast((draft) => draft.type === "DOCK" && draft.vertexId !== null);
  if (!dock) return null;
  return { x: dock.x, y: dock.y, theta: dock.theta, vertexId: dock.vertexId };
}

/**
 * The list with the item at `from` taken out and put back at `to` — not a swap:
 * dragging a step to the top means "run this first". A no-op returns the input
 * itself, so a drop back in place does not re-render.
 */
export function moveStep<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * The list with the row at `index` taken out of its group, ready to be removed
 * or moved. The row below keeps its link only if the departing row had one:
 * pulling B out of A–B–C leaves A–C, but pulling A out of A–B leaves B alone
 * rather than joined to whatever stood above A.
 */
export function unlinkStep(list: readonly StepDraft[], index: number): StepDraft[] {
  const leaving = list[index];
  if (!leaving) return [...list];
  return list.map((step, at) => {
    if (at === index) return step.withPrevious ? { ...step, withPrevious: false } : step;
    if (at === index + 1 && step.withPrevious && !leaving.withPrevious) {
      return { ...step, withPrevious: false };
    }
    return step;
  });
}

/** Where a row sits in the group it runs with, or null for a row on its own. */
export type GroupPlace = "start" | "middle" | "end" | null;

/** Whether row `index` really runs with the one above: the first row never does. */
function linked(drafts: readonly StepDraft[], index: number): boolean {
  return index > 0 && index < drafts.length && drafts[index]!.withPrevious;
}

export function stepGroupPlaces(drafts: readonly StepDraft[]): GroupPlace[] {
  return drafts.map((_, index) => {
    const up = linked(drafts, index);
    const down = linked(drafts, index + 1);
    if (up) return down ? "middle" : "end";
    return down ? "start" : null;
  });
}

/** A run of rows the editor draws as one item: a row on its own, or a group's box. */
export interface StepSpan {
  /** 0-based, inclusive at both ends; `start === end` for a row on its own. */
  start: number;
  end: number;
}

/** The list cut into the items the editor draws, top to bottom. */
export function stepSpans(drafts: readonly StepDraft[]): StepSpan[] {
  const spans: StepSpan[] = [];
  drafts.forEach((_, index) => {
    const last = spans[spans.length - 1];
    if (last && linked(drafts, index)) last.end = index;
    else spans.push({ start: index, end: index });
  });
  return spans;
}

/**
 * `moveStep` for drafts, deciding the row's group by where it lands:
 *
 * - Within its own group, it stays in the group.
 * - Anywhere else it leaves its group (see unlinkStep) and joins the one it
 *   lands inside; landing on a box's edge is outside it.
 *
 * The caller guards the no-op cases.
 */
export function moveStepDraft(list: readonly StepDraft[], from: number, to: number): StepDraft[] {
  const span = stepSpans(list).find((each) => each.start <= from && from <= each.end);
  if (!span || !list[to]) return [...list];
  // The editor asks stepMoveProblem first; this enforces it on every path.
  if (stepMoveProblem(list, from, to)) return [...list];
  if (span.end > span.start && span.start <= to && to <= span.end) {
    // The span keeps its slots; relink them in their new order.
    return moveStep([...list], from, to).map((step, at) =>
      at < span.start || at > span.end ? step : { ...step, withPrevious: at > span.start },
    );
  }
  const unlinked = unlinkStep(list, from);
  const row = unlinked[from]!;
  const rest = unlinked.filter((_, at) => at !== from);
  const joins = linked(rest, to);
  // The row pushed off the top becomes second, where a stale link would count.
  if (to === 0 && rest[0]?.withPrevious) rest[0] = { ...rest[0], withPrevious: false };
  rest.splice(to, 0, joins ? { ...row, withPrevious: true } : row);
  return rest;
}

/**
 * The `group` each row is sent with, or null for a row on its own. Named after
 * the group's first ordinal (`g2`), positional like `stepIdFor`.
 */
export function stepGroupNames(drafts: readonly StepDraft[]): (string | null)[] {
  let current: string | null = null;
  return stepGroupPlaces(drafts).map((place, index) => {
    if (place === "start") current = `g${index + 1}`;
    if (place === null) return null;
    return current;
  });
}

/** The steps that move the robot's body; the backend refuses two in one group. */
const BODY_STEP_TYPES: ReadonlySet<StepType> = new Set([
  "MOVE",
  "DOCK",
  "UNDOCK",
  "STANDUP",
  "LIEDOWN",
]);

const ONE_BODY_STEP = "The robot does one Move, Dock, Undock, Stand or Lie at a time";

function spanMoves(drafts: readonly StepDraft[], span: StepSpan | undefined): boolean {
  if (!span) return false;
  return drafts.slice(span.start, span.end + 1).some((draft) => BODY_STEP_TYPES.has(draft.type));
}

function spanOf(drafts: readonly StepDraft[], index: number): StepSpan | undefined {
  return stepSpans(drafts).find((span) => span.start <= index && index <= span.end);
}

/**
 * Why row `index` cannot run with the rows it is linked to, or null. Mirrors
 * the backend's `step_group_problem` body rule (a 400): every Move, Stand or
 * Lie after a group's first is marked.
 *
 * The editor never builds such a group (stepLinkProblem, stepMoveProblem); this
 * is the backstop for one handed in — an old draft or another client's template.
 */
export function stepGroupError(drafts: readonly StepDraft[], index: number): string | null {
  const draft = drafts[index];
  if (!draft || !BODY_STEP_TYPES.has(draft.type) || !linked(drafts, index)) return null;
  for (let at = index - 1; at >= 0; at -= 1) {
    if (BODY_STEP_TYPES.has(drafts[at]!.type)) {
      return `${ONE_BODY_STEP} — split the group above this step, or move it out.`;
    }
    if (!linked(drafts, at)) break;
  }
  return null;
}

/**
 * Why row `index` may not start together with the row above, or null. A link
 * joins the whole item above to the whole item below, so it is refused when
 * both bring a body step — only a clash the link itself would make.
 */
export function stepLinkProblem(drafts: readonly StepDraft[], index: number): string | null {
  if (index <= 0 || index >= drafts.length || linked(drafts, index)) return null;
  if (!spanMoves(drafts, spanOf(drafts, index - 1)) || !spanMoves(drafts, spanOf(drafts, index))) {
    return null;
  }
  return `${ONE_BODY_STEP}, and both of these already have one.`;
}

/**
 * Why moving row `from` to `to` would put it in a group it cannot run in, or
 * null. Mirrors moveStepDraft's landing rule.
 */
export function stepMoveProblem(
  list: readonly StepDraft[],
  from: number,
  to: number,
): string | null {
  const row = list[from];
  if (!row || !list[to] || from === to || !BODY_STEP_TYPES.has(row.type)) return null;
  const own = spanOf(list, from);
  if (own && own.end > own.start && own.start <= to && to <= own.end) return null;
  const rest = unlinkStep(list, from).filter((_, at) => at !== from);
  if (!linked(rest, to)) return null;
  const target = spanOf(rest, to)!;
  if (!spanMoves(rest, target)) return null;
  // Numbered as the list reads now, with the row still in it.
  const shown = (at: number) => (at < from ? at : at + 1) + 1;
  return `${ONE_BODY_STEP}, and steps ${shown(target.start)}–${shown(target.end)} already have one.`;
}

/** Whether a wire step (template, frozen schedule, run state) runs with the one above. */
export function wireLinked(
  steps: readonly { group?: string | null }[],
  index: number,
): boolean {
  const group = steps[index]?.group;
  return index > 0 && group != null && group === steps[index - 1]?.group;
}

/** `stepGroupPlaces` for wire steps. */
export function wireGroupPlaces(steps: readonly { group?: string | null }[]): GroupPlace[] {
  return steps.map((_, index) => {
    const up = wireLinked(steps, index);
    const down = wireLinked(steps, index + 1);
    if (up) return down ? "middle" : "end";
    return down ? "start" : null;
  });
}

/**
 * The step shape at a glance, for a template row: `M [M T] S` — the glyphs in
 * order, with the steps that run together bracketed.
 */
export function stepShape(steps: readonly { type: StepType; group?: string | null }[]): string {
  const places = wireGroupPlaces(steps);
  return steps
    .map((step, index) => {
      const glyph = stepGlyph(step.type);
      if (places[index] === "start") return `[${glyph}`;
      if (places[index] === "end") return `${glyph}]`;
      return glyph;
    })
    .join(" ");
}

/**
 * The step id the backend sees: `1-move`, `2-standup`, `3-move`.
 *
 * Position plus type: unique by construction and readable in a run's steps.
 * The client `key` would read `7-move` after deletions. The cost is that ids
 * match on-screen rows only while the list is unedited, so the composer
 * freezes the list during a dispatched task.
 */
export function stepIdFor(index: number, type: StepType): string {
  return `${index + 1}-${type.toLowerCase()}`;
}

/**
 * Why numeric fields are stored as strings: "", "-" and "1." are states typing
 * passes through, and as numbers they become 0 (a MOVE to the origin) or NaN
 * (sent as `null`, a 422 with a validation array). Text in, parsed once, here.
 */
function parseCoordinate(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function moveParams(draft: StepDraft): MoveStepParams | null {
  const x = parseCoordinate(draft.x);
  const y = parseCoordinate(draft.y);
  const theta = parseCoordinate(draft.theta);
  if (x === null || y === null || theta === null) return null;
  // Folded on the way out: rewriting the field under the cursor breaks typing "180".
  return { x, y, theta: normalizeTheta(theta) };
}

/** A SPEAK row's count, or null when what is typed is not a whole 1–50. */
function speakRepeat(draft: StepDraft): number | null {
  const text = draft.repeat.trim();
  if (!/^\d+$/.test(text)) return null;
  const repeat = Number(text);
  return repeat >= 1 && repeat <= SPEAK_REPEAT_MAX ? repeat : null;
}

/** What follows a quoted line said more than once: ` ×3`, or nothing for once. */
export function repeatSuffix(repeat: number | undefined): string {
  return repeat !== undefined && repeat > 1 ? ` ×${repeat}` : "";
}

function waitParams(draft: StepDraft): WaitStepParams | null {
  const seconds = parseCoordinate(draft.seconds);
  if (seconds === null || seconds <= 0 || seconds > WAIT_SECONDS_MAX) return null;
  return { seconds };
}

/** The operator-facing reason this row cannot be sent, or null. */
export function stepDraftError(draft: StepDraft): string | null {
  if (draft.type === "SPEAK") {
    const text = draft.text.trim();
    if (!text) return "Needs something to say.";
    // Checked here: the backend's 422 detail would be a validation array, not
    // a sentence. Likewise the bounds below.
    if (text.length > SPEAK_TEXT_MAX) {
      return `Too long — ${text.length} of ${SPEAK_TEXT_MAX} characters.`;
    }
    if (speakRepeat(draft) === null) {
      return `Say it 1 to ${SPEAK_REPEAT_MAX} times.`;
    }
    return null;
  }
  if (draft.type === "WAIT") {
    const seconds = parseCoordinate(draft.seconds);
    if (seconds === null) return "Needs a duration in seconds.";
    if (seconds <= 0) return "Needs a duration longer than 0 seconds.";
    if (seconds > WAIT_SECONDS_MAX) {
      return `At most ${WAIT_SECONDS_MAX} seconds (1 hour).`;
    }
    return null;
  }
  if (!isNavStep(draft)) return null;
  // No theta range check: normalizeTheta folds 270° to -90°.
  return moveParams(draft) ? null : "Pick a waypoint.";
}

/**
 * True when the whole list can be dispatched. The empty list is refused: the
 * backend accepts `steps: []` and reports COMPLETED having moved nothing.
 */
export function stepDraftsSubmittable(drafts: readonly StepDraft[]): boolean {
  return (
    drafts.length > 0 &&
    drafts.every((draft, index) => !stepDraftError(draft) && !stepGroupError(drafts, index))
  );
}

function toStepRequest(draft: StepDraft, index: number): TaskStepRequest {
  const id = stepIdFor(index, draft.type);
  if (draft.type === "SPEAK") {
    const text = draft.text.trim();
    // Callers gate on stepDraftsSubmittable, so these throws are programming errors.
    if (!text) throw new Error(`Step ${id} has nothing to say.`);
    const repeat = speakRepeat(draft);
    if (repeat === null) throw new Error(`Step ${id} has no usable count.`);
    // No voice / speed keys: sending them would freeze today's defaults into
    // saved templates. `repeat` only above once.
    return { id, type: "SPEAK", params: repeat > 1 ? { text, repeat } : { text } };
  }
  if (draft.type === "WAIT") {
    const params = waitParams(draft);
    if (!params) throw new Error(`Step ${id} has no usable duration.`);
    return { id, type: "WAIT", params };
  }
  if (draft.type === "STANDUP" || draft.type === "LIEDOWN") return { id, type: draft.type };

  const params = moveParams(draft);
  // Throwing beats sending a MOVE to (0, 0).
  if (!params) throw new Error(`Step ${id} has no usable coordinates.`);
  return { id, type: draft.type, params };
}

/** The list in wire shape. A row on its own carries no `group` key at all. */
export function toStepRequests(
  drafts: readonly StepDraft[],
): TaskStepRequest[] {
  const groups = stepGroupNames(drafts);
  return drafts.map((draft, index) => {
    const request = toStepRequest(draft, index);
    const group = groups[index];
    return group ? { ...request, group } : request;
  });
}

/**
 * The authored list as the task-template endpoint stores it: `toStepRequests`
 * plus each waypoint step's `vertex_id`, so it can follow the map later.
 */
export function toTemplateSteps(
  drafts: readonly StepDraft[],
): TemplateStepRequest[] {
  return toStepRequests(drafts).map((request, index) => {
    const draft = drafts[index]!;
    if (!isNavStep(request)) return request;
    // Waypoint steps only: the backend 422s any other step that carries one.
    return { ...request, vertex_id: draft.vertexId };
  });
}

/**
 * Load a template's steps back into the editor.
 *
 * From `resolved_params`, **not** `params`: the server applies "the vertex's
 * current pose wins, the snapshot is the fallback", so a moved dock shows up
 * here. The formatters match the vertex picker's, so save/load round-trips.
 */
export function fromTemplateSteps(steps: readonly TemplateStep[]): StepDraft[] {
  return steps.map((step, index) => {
    const draft = { ...newStepDraft(step.type), withPrevious: wireLinked(steps, index) };
    if (isNavStep(step)) {
      const pose = step.resolved_params;
      return {
        ...draft,
        x: pose ? formatDraftPosition(pose.x) : draft.x,
        y: pose ? formatDraftPosition(pose.y) : draft.y,
        theta: pose ? formatDraftAngle(pose.theta) : draft.theta,
        vertexId: step.vertex_id,
        vertexMissing: step.vertex_status === "MISSING",
      };
    }
    if (step.type === "SPEAK") {
      // For a SPEAK resolved_params is the snapshot verbatim.
      return {
        ...draft,
        text: step.resolved_params?.text ?? draft.text,
        repeat: String(step.resolved_params?.repeat ?? 1),
      };
    }
    if (step.type === "WAIT") {
      const seconds = step.resolved_params?.seconds;
      return { ...draft, seconds: seconds === undefined ? draft.seconds : String(seconds) };
    }
    return draft;
  });
}

/**
 * Project a template's steps into the dispatch wire shape: `resolved_params`
 * minus the provenance. A posture step gets no `params` key at all.
 */
export function toDispatchSteps(steps: readonly TemplateStep[]): TaskStepRequest[] {
  return steps.map((step): TaskStepRequest => {
    const request = dispatchStep(step);
    // The stored name verbatim; a step on its own carries no key.
    return step.group ? { ...request, group: step.group } : request;
  });
}

function dispatchStep(step: TemplateStep): TaskStepRequest {
  switch (step.type) {
    case "MOVE":
    case "DOCK":
    case "UNDOCK":
      return {
        id: step.id,
        type: step.type,
        // Non-null by construction (vertex pose or snapshot). Falling back to
        // an origin would be a silent drive to (0, 0), so this throws.
        params: assertResolved(step, "no coordinates"),
      };
    case "SPEAK":
      // Likewise: the backend refuses to store a SPEAK without text.
      return { id: step.id, type: "SPEAK", params: assertResolved(step, "no text") };
    case "WAIT":
      return { id: step.id, type: "WAIT", params: assertResolved(step, "no duration") };
    default:
      return { id: step.id, type: step.type };
  }
}

function assertResolved<T>(
  step: { id: string; resolved_params: T | null },
  missing: string,
): T {
  if (!step.resolved_params) {
    throw new Error(`Template step "${step.id}" has ${missing} to dispatch.`);
  }
  return step.resolved_params;
}
