// The task editor's stops: the flat step list read as the route it is.
//
// An engineer on site builds a job by walking it: the waypoints first, then
// what the robot does at each. The wire stays a flat list with groups, and so
// does the draft; this module only reads that list as stops and edits it in
// those terms, so nothing sent, stored or scheduled changes shape.
//
//   rows before the first stop   done before setting off
//   a Move or Dock row           a stop
//   rows in its group after it   done while walking there
//   rows after that, up to the   done on arrival
//   next stop
//
// The reading needs every group with a stop in it to start with the stop.
// A group starts its steps together, so `[Speak, Move]` and `[Move, Speak]`
// run alike; normalizeStops puts the stop first, which changes the
// positional step ids of a job saved the other way and nothing else.

import {
  isNavStep,
  moveStepDraft,
  newStepDraft,
  stepLinkProblem,
  stepMoveProblem,
  stepOccupiesBody,
  stepSpans,
  unlinkStep,
  type StepDraft,
} from "@/lib/task/step";

/** One stop: its row and the two runs of rows that belong to it. */
export interface StopBlock {
  /** The stop row's key. */
  key: number;
  /** The stop row's index. */
  index: number;
  /** Exclusive: rows `(index, transitEnd)` start together with the walk. */
  transitEnd: number;
  /** Exclusive: rows `[transitEnd, end)` are done on arrival. */
  end: number;
}

export interface StopLayout {
  /** Exclusive: rows `[0, startEnd)` are done before the first stop. */
  startEnd: number;
  stops: StopBlock[];
}

/** Where an action sits: before setting off, or on the way to or at a stop (by its key). */
export type StopSection =
  | { kind: "start" }
  | { kind: "transit"; stop: number }
  | { kind: "arrival"; stop: number };

/**
 * The list with every group able to read as stops:
 *
 * - a body step linked into a group that already has one is unlinked — the
 *   backend refuses such a group, so only an old draft can hold one;
 * - a group holding a stop is reordered to start with it.
 *
 * The input itself when nothing changes, so a normalised list re-renders
 * nothing and reads as unedited.
 */
export function normalizeStops(steps: readonly StepDraft[]): StepDraft[] {
  let changed = false;
  let spanHasBody = false;
  const unclashed = steps.map((step, index) => {
    const body = stepOccupiesBody(step.type);
    if (index === 0 || !step.withPrevious) {
      spanHasBody = body;
      if (index === 0 && step.withPrevious) {
        changed = true;
        return { ...step, withPrevious: false };
      }
      return step;
    }
    if (body && spanHasBody) {
      changed = true;
      return { ...step, withPrevious: false };
    }
    spanHasBody ||= body;
    return step;
  });

  const ordered: StepDraft[] = [];
  for (const span of stepSpans(unclashed)) {
    const members = unclashed.slice(span.start, span.end + 1);
    const stop = members.findIndex(isNavStep);
    if (stop <= 0) {
      ordered.push(...members);
      continue;
    }
    changed = true;
    const leader = members[stop]!;
    const rest = members.filter((_, at) => at !== stop);
    ordered.push({ ...leader, withPrevious: false });
    for (const member of rest) ordered.push({ ...member, withPrevious: true });
  }
  return changed ? ordered : (steps as StepDraft[]);
}

/** The list read as stops. Expects a normalised list (normalizeStops). */
export function stopLayout(steps: readonly StepDraft[]): StopLayout {
  const indices: number[] = [];
  steps.forEach((step, index) => {
    if (isNavStep(step)) indices.push(index);
  });
  const stops = indices.map((index, at): StopBlock => {
    const end = indices[at + 1] ?? steps.length;
    let transitEnd = index + 1;
    while (transitEnd < end && steps[transitEnd]!.withPrevious) transitEnd += 1;
    return { key: steps[index]!.key, index, transitEnd, end };
  });
  return { startEnd: indices[0] ?? steps.length, stops };
}

/** Rows `[from, to)` of a section. Null for a stop no longer in the list. */
export function sectionRange(
  layout: StopLayout,
  section: StopSection,
): { from: number; to: number } | null {
  if (section.kind === "start") return { from: 0, to: layout.startEnd };
  const block = layout.stops.find((stop) => stop.key === section.stop);
  if (!block) return null;
  return section.kind === "transit"
    ? { from: block.index + 1, to: block.transitEnd }
    : { from: block.transitEnd, to: block.end };
}

/** The section a row is an action in; null for a stop's own row or a key not in the list. */
export function sectionOf(steps: readonly StepDraft[], key: number): StopSection | null {
  const index = steps.findIndex((step) => step.key === key);
  if (index === -1 || isNavStep(steps[index]!)) return null;
  const layout = stopLayout(steps);
  if (index < layout.startEnd) return { kind: "start" };
  const block = layout.stops.find((stop) => stop.index < index && index < stop.end)!;
  return index < block.transitEnd
    ? { kind: "transit", stop: block.key }
    : { kind: "arrival", stop: block.key };
}

/**
 * The stop a row belongs to, for the map's next tap: its own key for a stop,
 * the stop an action is done at or on the way to, "start" before setting off,
 * null for a key not in the list.
 */
export function stopOfRow(steps: readonly StepDraft[], key: number): number | "start" | null {
  const row = steps.find((step) => step.key === key);
  if (!row) return null;
  if (isNavStep(row)) return row.key;
  const section = sectionOf(steps, key)!;
  return section.kind === "start" ? "start" : section.stop;
}

function insertAt(steps: readonly StepDraft[], at: number, row: StepDraft): StepDraft[] {
  const next = [...steps];
  next.splice(at, 0, row);
  return next;
}

/**
 * The list with a stop row added: after the stop `after` and everything done
 * there, never between a stop and its actions — that would hand the earlier
 * stop's arrival to the new one. "start" adds it ahead of the first stop,
 * null at the end.
 */
export function insertStop(
  steps: readonly StepDraft[],
  after: number | "start" | null,
  row: StepDraft,
): StepDraft[] {
  const layout = stopLayout(steps);
  const block = typeof after === "number" ? layout.stops.find((stop) => stop.key === after) : null;
  const at =
    after === "start"
      ? (layout.stops[0]?.index ?? steps.length)
      : block
        ? block.end
        : steps.length;
  return insertAt(steps, at, { ...row, withPrevious: false });
}

/** Why an action of this type may not go in this section, or null. */
export function sectionProblem(section: StopSection, row: Pick<StepDraft, "type">): string | null {
  if (isNavStep(row)) return "A waypoint is a stop of its own.";
  if (section.kind === "transit" && stepOccupiesBody(row.type)) {
    return "The robot is already walking; it cannot also stand or lie down.";
  }
  return null;
}

/** The list with an action added at the end of a section; unchanged when it may not go there. */
export function addAction(
  steps: readonly StepDraft[],
  section: StopSection,
  row: StepDraft,
): StepDraft[] {
  const range = sectionRange(stopLayout(steps), section);
  if (!range || sectionProblem(section, row)) return [...steps];
  return insertAt(steps, range.to, { ...row, withPrevious: section.kind === "transit" });
}

/** The list without a stop and everything done on the way there or at it. */
export function removeStop(steps: readonly StepDraft[], key: number): StepDraft[] {
  const block = stopLayout(steps).stops.find((stop) => stop.key === key);
  if (!block) return [...steps];
  return [...steps.slice(0, block.index), ...steps.slice(block.end)];
}

/**
 * The list with a stop, its walk and its arrival moved to stop position `to`
 * (0-based, among the stops). The rows before setting off stay first.
 */
export function moveStop(steps: readonly StepDraft[], key: number, to: number): StepDraft[] {
  const layout = stopLayout(steps);
  const from = layout.stops.findIndex((stop) => stop.key === key);
  if (from === -1 || to < 0 || to >= layout.stops.length || from === to) return [...steps];
  const blocks = layout.stops.map((stop) => steps.slice(stop.index, stop.end));
  const [moving] = blocks.splice(from, 1);
  blocks.splice(to, 0, moving!);
  return [...steps.slice(0, layout.startEnd), ...blocks.flat()];
}

function copyOf(row: StepDraft): StepDraft {
  return { ...row, key: newStepDraft(row.type).key };
}

/** The list without one action; the rows it started together with stay together. */
export function removeAction(steps: readonly StepDraft[], key: number): StepDraft[] {
  const index = steps.findIndex((step) => step.key === key);
  if (index === -1) return [...steps];
  return unlinkStep(steps, index).filter((step) => step.key !== key);
}

/** The list with a copy of an action after the box it is in, on its own (or on the walk). */
export function duplicateAction(steps: readonly StepDraft[], key: number): StepDraft[] {
  const index = steps.findIndex((step) => step.key === key);
  const section = sectionOf(steps, key);
  if (index === -1 || !section) return [...steps];
  const copy = copyOf(steps[index]!);
  if (section.kind === "transit") {
    const range = sectionRange(stopLayout(steps), section)!;
    return insertAt(steps, range.to, { ...copy, withPrevious: true });
  }
  const span = stepSpans(steps).find((each) => each.start <= index && index <= each.end)!;
  return insertAt(steps, span.end + 1, { ...copy, withPrevious: false });
}

/**
 * The sections an action moves through with Move up and Move down, in list
 * order: before setting off, then each stop's arrival. The walk is not one of
 * them; an action joins or leaves it by setTransit.
 */
function arrivalSections(layout: StopLayout): StopSection[] {
  return [
    { kind: "start" },
    ...layout.stops.map((stop): StopSection => ({ kind: "arrival", stop: stop.key })),
  ];
}

export function sameSection(a: StopSection, b: StopSection): boolean {
  return a.kind === b.kind && (a.kind === "start" || a.stop === (b as { stop: number }).stop);
}

/**
 * Where Move up or Move down takes an action: a row along in its section, or
 * from the edge of an arrival to the next one over. Null at the very top or
 * bottom, on a walk's edge, or where the row would land in a box that already
 * has a body step.
 */
export function actionMoveTarget(
  steps: readonly StepDraft[],
  key: number,
  direction: "up" | "down",
): { kind: "row"; index: number } | { kind: "section"; section: StopSection } | null {
  const index = steps.findIndex((step) => step.key === key);
  const section = sectionOf(steps, key);
  if (index === -1 || !section) return null;
  const layout = stopLayout(steps);
  const range = sectionRange(layout, section)!;
  const to = direction === "up" ? index - 1 : index + 1;
  if (to >= range.from && to < range.to) {
    return stepMoveProblem(steps, index, to) ? null : { kind: "row", index: to };
  }
  if (section.kind === "transit") return null;
  const order = arrivalSections(layout);
  const at = order.findIndex((each) => sameSection(each, section));
  const next = order[direction === "up" ? at - 1 : at + 1];
  return next ? { kind: "section", section: next } : null;
}

/** Move up or Move down, as actionMoveTarget decides; unchanged when it has nowhere to go. */
export function moveAction(
  steps: readonly StepDraft[],
  key: number,
  direction: "up" | "down",
): StepDraft[] {
  const target = actionMoveTarget(steps, key, direction);
  if (!target) return [...steps];
  const index = steps.findIndex((step) => step.key === key);
  if (target.kind === "row") return moveStepDraft(steps, index, target.index);
  const row = { ...steps[index]!, withPrevious: false };
  const rest = removeAction(steps, key);
  const range = sectionRange(stopLayout(rest), target.section)!;
  // Up lands last in the section above, down first in the one below.
  return insertAt(rest, direction === "up" ? range.to : range.from, row);
}

/**
 * The list with an action moved to a row index inside its own section, for a
 * drag; unchanged when the drop would leave the section or land in a box
 * that already has a body step.
 */
export function moveActionTo(steps: readonly StepDraft[], key: number, to: number): StepDraft[] {
  const index = steps.findIndex((step) => step.key === key);
  const section = sectionOf(steps, key);
  if (index === -1 || !section || index === to) return [...steps];
  const range = sectionRange(stopLayout(steps), section)!;
  if (to < range.from || to >= range.to || stepMoveProblem(steps, index, to)) return [...steps];
  return moveStepDraft(steps, index, to);
}

/**
 * The list with an action moved onto the walk to its stop (`true`), or off it
 * to the start of the stop's arrival (`false`). Unchanged before the first
 * stop, which has no walk, and for a step that occupies the body.
 */
export function setTransit(
  steps: readonly StepDraft[],
  key: number,
  onWalk: boolean,
): StepDraft[] {
  const section = sectionOf(steps, key);
  if (!section || section.kind === "start") return [...steps];
  if ((section.kind === "transit") === onWalk) return [...steps];
  const row = steps.find((step) => step.key === key)!;
  const target: StopSection = { kind: onWalk ? "transit" : "arrival", stop: section.stop };
  if (sectionProblem(target, row)) return [...steps];
  const rest = removeAction(steps, key);
  const range = sectionRange(stopLayout(rest), target)!;
  return onWalk
    ? insertAt(rest, range.to, { ...row, withPrevious: true })
    : insertAt(rest, range.from, { ...row, withPrevious: false });
}

/**
 * Why an action may not start together with the one above it, or null. Only
 * inside its own section: the first row of an arrival would otherwise join
 * the walk, which is what setTransit is for.
 */
export function actionLinkProblem(steps: readonly StepDraft[], key: number): string | null {
  const index = steps.findIndex((step) => step.key === key);
  const section = sectionOf(steps, key);
  if (index === -1 || !section || section.kind === "transit") return "Not here.";
  const range = sectionRange(stopLayout(steps), section)!;
  if (index === range.from) return "Nothing above it here to start with.";
  return stepLinkProblem(steps, index);
}

/** Vertex id → the 1-based numbers of the stops that go there, for the map's marks. */
export function stopWaypointOrdinals(
  steps: readonly StepDraft[],
): ReadonlyMap<string, readonly number[]> {
  const marks = new Map<string, number[]>();
  let ordinal = 0;
  for (const step of steps) {
    if (!isNavStep(step)) continue;
    ordinal += 1;
    if (step.vertexId === null) continue;
    const list = marks.get(step.vertexId) ?? [];
    list.push(ordinal);
    marks.set(step.vertexId, list);
  }
  return marks;
}

/** The line over the stops that says what the job comes to before it is handed over. */
export interface JobSummary {
  stops: number;
  /** Every Wait that reads as a duration, summed; a half-typed one counts nothing. */
  waitSeconds: number;
  /** The last stop: where the robot is when the job ends, and whether it docked there. */
  end: { name: string | null; dock: boolean } | null;
}

export function jobSummary(
  steps: readonly StepDraft[],
  nameOf: (vertexId: string) => string | null,
): JobSummary {
  let stops = 0;
  let waitSeconds = 0;
  let last: StepDraft | null = null;
  for (const step of steps) {
    if (isNavStep(step)) {
      stops += 1;
      last = step;
    } else if (step.type === "WAIT") {
      const seconds = Number(step.seconds.trim());
      if (step.seconds.trim() && Number.isFinite(seconds) && seconds > 0) waitSeconds += seconds;
    }
  }
  return {
    stops,
    waitSeconds,
    end: last
      ? { name: last.vertexId === null ? null : nameOf(last.vertexId), dock: last.type === "DOCK" }
      : null,
  };
}

/** A duration as an operator reads it: `45 s`, `1 min 30 s`, `1 h 5 min`. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${Number(seconds.toFixed(1))} s`;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
