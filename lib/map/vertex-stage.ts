// The floor plan editor's staged waypoints: what Save would send, and what
// the editor holds once some of it has landed.
//
// The editor keeps two lists, as it does for forbidden zones — `saved`, the
// rows as the robot holds them, and `working`, what is on screen — and Save
// writes the difference. A waypoint placed here has no server id until the
// create answers, so it carries a local one; that keeps it a plain MapVertex
// the canvas, the selection and the form already know how to handle.
//
// React-free so the diff rules can be held by a unit test: nothing here
// knows how a request is sent, only which ones a change needs.

import { normalizeTheta } from "@/lib/angle";
import type { MapVertex, VertexType } from "@/lib/types/map";

/**
 * Not a uuid, so it can never collide with a row id the backend issued — and
 * a prefix rather than a flag beside the row, so a selection (which holds
 * ids alone) can still tell a staged waypoint from a stored one.
 */
const LOCAL_ID_PREFIX = "local:";

export function localVertexId(serial: number): string {
  return `${LOCAL_ID_PREFIX}${serial}`;
}

export function isLocalVertex(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

/** The fields an operator sets; `id` and `map_name` are not theirs. */
export interface StagedDraft {
  name: string;
  type: VertexType;
  x: number;
  y: number;
  theta: number;
}

export interface VertexSavePlan {
  deletes: string[];
  updates: { id: string; changes: Partial<StagedDraft> }[];
  creates: { localId: string; draft: StagedDraft }[];
}

/** Every change Save would write, from the robot's rows to the screen's. */
export function planVertexSave(
  saved: readonly MapVertex[],
  working: readonly MapVertex[],
): VertexSavePlan {
  const kept = new Map(working.map((vertex) => [vertex.id, vertex]));
  const deletes = saved.filter((vertex) => !kept.has(vertex.id)).map((vertex) => vertex.id);

  const stored = new Map(saved.map((vertex) => [vertex.id, vertex]));
  const updates: VertexSavePlan["updates"] = [];
  const creates: VertexSavePlan["creates"] = [];
  for (const vertex of working) {
    const before = stored.get(vertex.id);
    if (before) {
      const changes = changedFields(before, vertex);
      if (changes) updates.push({ id: vertex.id, changes });
    } else if (isLocalVertex(vertex.id)) {
      creates.push({ localId: vertex.id, draft: draftOf(vertex) });
    }
    // A server id that is in neither list cannot be staged here; it is a row
    // another console added after this one loaded, and it is not ours to send.
  }
  return { deletes, updates, creates };
}

export function isEmptyPlan(plan: VertexSavePlan): boolean {
  return !plan.deletes.length && !plan.updates.length && !plan.creates.length;
}

/** Whether the screen still matches what the robot holds. */
export function sameVertices(
  saved: readonly MapVertex[],
  working: readonly MapVertex[],
): boolean {
  return isEmptyPlan(planVertexSave(saved, working));
}

/** What a save got through before it stopped, in the order it was sent. */
export interface VertexSaveLanded {
  deleted: string[];
  updated: MapVertex[];
  /** Each create's echo beside the local id it replaces. */
  created: { localId: string; vertex: MapVertex }[];
}

/**
 * Fold what landed into both lists.
 *
 * `saved` takes exactly the writes that landed, so whatever did not is still
 * a difference and Save stays lit for the retry. `working` swaps each created
 * row's local id for the one the robot issued, and otherwise keeps what is on
 * screen — including anything edited while the requests were in flight.
 * `ids` is that swap, for the selection, which holds ids alone.
 */
export function rebaseVertices(
  saved: readonly MapVertex[],
  working: readonly MapVertex[],
  landed: VertexSaveLanded,
): { saved: MapVertex[]; working: MapVertex[]; ids: Map<string, string> } {
  const deleted = new Set(landed.deleted);
  const updated = new Map(landed.updated.map((vertex) => [vertex.id, vertex]));
  const ids = new Map(landed.created.map(({ localId, vertex }) => [localId, vertex.id]));
  const created = new Map(landed.created.map(({ localId, vertex }) => [localId, vertex]));

  const nextSaved = [
    ...saved
      .filter((vertex) => !deleted.has(vertex.id))
      .map((vertex) => updated.get(vertex.id) ?? vertex),
    ...landed.created.map(({ vertex }) => vertex),
  ];
  const nextWorking = working.map((vertex) => {
    const echo = created.get(vertex.id);
    if (!echo) return vertex;
    // The echo is what the robot stored; the screen keeps any edit made to
    // the staged row since the request left, under its new id.
    return { ...vertex, id: echo.id, map_name: echo.map_name };
  });
  return { saved: nextSaved, working: nextWorking, ids };
}

/** What a save wrote, for its note: "2 added · 1 changed · 1 deleted". */
export function vertexSaveSummary(landed: VertexSaveLanded): string {
  const parts = [
    landed.created.length && `${landed.created.length} added`,
    landed.updated.length && `${landed.updated.length} changed`,
    landed.deleted.length && `${landed.deleted.length} deleted`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing to write.";
}

/**
 * A stopped save's note. The backend's sentence stays verbatim and last; what
 * landed before it goes first, because "not saved" over a save that deleted
 * two stops would be a lie the next look at the map exposes.
 */
export function vertexSaveFailure(landed: VertexSaveLanded, failure: string): string {
  const wrote = landed.created.length + landed.updated.length + landed.deleted.length;
  return wrote
    ? `Saved first: ${vertexSaveSummary(landed)}. The rest are still unsaved. ${failure}`
    : failure;
}

function draftOf(vertex: MapVertex): StagedDraft {
  return {
    name: vertex.name,
    type: vertex.type,
    x: vertex.x,
    y: vertex.y,
    theta: normalizeTheta(vertex.theta),
  };
}

/**
 * Only the fields that moved, or null. The heading is compared folded, so
 * -180 against a stored 180 is no change — the backend would store the same
 * row and the Save dot would be lit for nothing.
 */
function changedFields(before: MapVertex, after: MapVertex): Partial<StagedDraft> | null {
  const changes: Partial<StagedDraft> = {};
  if (after.name !== before.name) changes.name = after.name;
  if (after.type !== before.type) changes.type = after.type;
  if (after.x !== before.x) changes.x = after.x;
  if (after.y !== before.y) changes.y = after.y;
  const theta = normalizeTheta(after.theta);
  if (theta !== normalizeTheta(before.theta)) changes.theta = theta;
  return Object.keys(changes).length ? changes : null;
}
