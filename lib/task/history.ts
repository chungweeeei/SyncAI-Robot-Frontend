// The job history's rules: run durations, the filter and how it travels (to the
// backend as a query, to the address bar as search params), and the dashboard's
// arithmetic.

import type {
  TaskHistoryFilterQuery,
  TaskHistoryKind,
  TaskHistoryStats,
  TaskHistoryStatus,
} from "@/lib/api/task";

/**
 * Seconds between a run's start and close (server timestamps), or null without
 * a close time — 0 would be a claim about the run. A negative span (backend
 * clock skew) clamps to zero.
 */
export function runSeconds(
  startedAt: string,
  closedAt: string | null,
): number | null {
  if (closedAt === null) return null;
  const start = Date.parse(startedAt);
  const close = Date.parse(closedAt);
  if (Number.isNaN(start) || Number.isNaN(close)) return null;
  return Math.max(0, Math.floor((close - start) / 1000));
}

// ---------------------------------------------------------------------------
// The filter

export type TimeRangePreset = "1h" | "6h" | "24h";

export const TIME_RANGE_PRESETS: readonly {
  value: TimeRangePreset;
  label: string;
  hours: number;
}[] = [
  { value: "1h", label: "Last 1 h", hours: 1 },
  { value: "6h", label: "Last 6 h", hours: 6 },
  { value: "24h", label: "Last 24 h", hours: 24 },
];

/** A preset reaching back from now, or two ISO 8601 UTC bounds the operator typed. */
export type HistoryRange = { preset: TimeRangePreset } | { from: string; to: string };

export type HistoryStatusFilter = TaskHistoryStatus | "ALL";

/** The screen's filter as the operator set it — what the address bar carries. */
export interface HistoryFilter {
  status: HistoryStatusFilter;
  range: HistoryRange;
  kind: TaskHistoryKind | null;
  name: string | null;
}

const DEFAULT_RANGE_PRESET: TimeRangePreset = "24h";

/** The last day, every outcome, every kind: a plain `/history`, and what "clear the filters" means. */
export const DEFAULT_HISTORY_FILTER: HistoryFilter = {
  status: "ALL",
  range: { preset: DEFAULT_RANGE_PRESET },
  kind: null,
  name: null,
};

/** Every kind a finished run can carry, in the order the dashboard lists them. */
export const HISTORY_KINDS: readonly TaskHistoryKind[] = [
  "goal",
  "standup",
  "liedown",
  "task",
  "schedule",
];

// The posture words match the drive panel's buttons, so a job reads the same here as where it was pressed.
const KIND_LABEL: Record<TaskHistoryKind, string> = {
  goal: "Navigation goal",
  standup: "Stand",
  liedown: "Lie down",
  task: "Task",
  schedule: "Scheduled",
};

/**
 * What a kind is called on screen. An unknown kind, or none, reads "Other" —
 * a label that makes no claim about what the run was.
 */
export function kindLabel(kind: string | null): string {
  return isHistoryKind(kind) ? KIND_LABEL[kind] : "Other";
}

export function isHistoryKind(value: unknown): value is TaskHistoryKind {
  return typeof value === "string" && (HISTORY_KINDS as readonly string[]).includes(value);
}

function isPreset(value: unknown): value is TimeRangePreset {
  return TIME_RANGE_PRESETS.some((preset) => preset.value === value);
}

const HOUR_MS = 3_600_000;

/**
 * The close-time bounds a range asks the backend for.
 *
 * A preset is `since` only: a job finishing while the page is open must land
 * inside the window for the active-task poll's refresh to show it, and an
 * `until` of "now" would exclude it. `nowMs` is handed in so the caller decides
 * when the window is anchored (see useHistoryFilter).
 */
export function resolveTimeRange(
  range: HistoryRange,
  nowMs: number,
): { since: string; until?: string } {
  if ("preset" in range) {
    const hours = TIME_RANGE_PRESETS.find((p) => p.value === range.preset)?.hours ?? 24;
    return { since: new Date(nowMs - hours * HOUR_MS).toISOString() };
  }
  return { since: range.from, until: range.to };
}

export function toHistoryQuery(filter: HistoryFilter, nowMs: number): TaskHistoryFilterQuery {
  const { since, until } = resolveTimeRange(filter.range, nowMs);
  return {
    status: filter.status === "ALL" ? undefined : filter.status,
    since,
    until,
    kind: filter.kind ?? undefined,
    name: filter.name ?? undefined,
  };
}

/**
 * The wire filter the dashboard counts under: the list's, minus the outcome.
 * Counting under one outcome would zero the other tiles and make the success
 * rate 0 % or 100 % by construction.
 */
export function toHistoryStatsQuery(
  filter: HistoryFilter,
  nowMs: number,
): TaskHistoryFilterQuery {
  return toHistoryQuery({ ...filter, status: "ALL" }, nowMs);
}

/** True when nothing is narrowed — what a plain `/history` shows, and what Reset returns to. */
export function isDefaultHistoryFilter(filter: HistoryFilter): boolean {
  return serializeHistoryFilter(filter).toString() === "";
}

/** The two lines a history row shows for a run. */
export interface RunDescription {
  /** What the operator calls the job: its template's name, its kind, or — for a run nothing labelled — its id. */
  title: string;
  /** Where it came from, under the title. */
  detail: string;
}

/**
 * How a finished run is named on screen: the template name the operator gave
 * it, else its kind (a dragged goal, a posture button), else — for a run
 * nothing labelled (MCP server, curl, an older build) — its id.
 */
export function describeRun(entry: {
  id: string;
  kind: string | null;
  name: string | null;
  schedule_id: string | null;
}): RunDescription {
  const scheduled = entry.schedule_id !== null;
  const source = scheduled ? `Scheduled · ${entry.schedule_id}` : "Started directly";
  if (entry.name) {
    return {
      title: entry.name,
      // A scheduled run's source already says what kind it is.
      detail:
        scheduled || !isHistoryKind(entry.kind)
          ? source
          : `${kindLabel(entry.kind)} · ${source}`,
    };
  }
  if (scheduled) {
    return { title: entry.schedule_id as string, detail: "Scheduled" };
  }
  if (isHistoryKind(entry.kind)) {
    return { title: kindLabel(entry.kind), detail: source };
  }
  return { title: entry.id, detail: source };
}

/**
 * A canonical string for a wire filter, in fixed field order, so equal filters
 * make the same query key. JSON so a name containing a separator stays unambiguous.
 */
export function historyQueryKey(query: TaskHistoryFilterQuery): string {
  return JSON.stringify([
    query.status ?? "",
    query.since ?? "",
    query.until ?? "",
    query.kind ?? "",
    query.name ?? "",
  ]);
}

const STATUS_FILTERS: readonly HistoryStatusFilter[] = ["ALL", "COMPLETED", "FAILED", "CANCELED"];

/** A custom range's bounds must parse, or the backend answers 422. */
function isIsoTime(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value));
}

/**
 * The filter a `/history?…` address names. Tolerant field by field: an
 * unreadable value falls back to that field's default, so an old bookmark
 * still opens on something sensible.
 *
 * Search params: `status`, `range` (a preset, or `custom` with `from` and `to`
 * as ISO 8601 UTC), `kind`, `name`. A custom range missing a bound or ending
 * before it starts falls back to the default.
 */
export function parseHistoryFilter(params: URLSearchParams): HistoryFilter {
  const status = params.get("status");
  const range = params.get("range");
  const from = params.get("from");
  const to = params.get("to");
  const kind = params.get("kind");
  const name = params.get("name");

  let parsedRange: HistoryRange = DEFAULT_HISTORY_FILTER.range;
  if (isPreset(range)) {
    parsedRange = { preset: range };
  } else if (
    range === "custom" &&
    isIsoTime(from) &&
    isIsoTime(to) &&
    Date.parse(from) <= Date.parse(to)
  ) {
    parsedRange = { from, to };
  }

  return {
    status: (STATUS_FILTERS as readonly string[]).includes(status ?? "")
      ? (status as HistoryStatusFilter)
      : DEFAULT_HISTORY_FILTER.status,
    range: parsedRange,
    kind: isHistoryKind(kind) ? kind : null,
    name: name ? name : null,
  };
}

/** The address for a filter. Defaults are left out, so a copied link carries only what changed. */
export function serializeHistoryFilter(filter: HistoryFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status !== "ALL") params.set("status", filter.status);
  if ("preset" in filter.range) {
    if (filter.range.preset !== DEFAULT_RANGE_PRESET) {
      params.set("range", filter.range.preset);
    }
  } else {
    params.set("range", "custom");
    params.set("from", filter.range.from);
    params.set("to", filter.range.to);
  }
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.name) params.set("name", filter.name);
  return params;
}

/**
 * The bounds "Custom" starts from: the window already on screen, closed at
 * now, so the inputs are never blank and an edit refines what was shown.
 */
export function customRangeSeed(range: HistoryRange, nowMs: number): { from: string; to: string } {
  if (!("preset" in range)) return { from: range.from, to: range.to };
  return {
    from: resolveTimeRange(range, nowMs).since,
    to: new Date(nowMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// datetime-local ↔ ISO

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * An ISO 8601 instant as `<input type="datetime-local">` wants it, via `Date`'s
 * local getters rather than Intl so nothing depends on a locale. Empty for an
 * unreadable time.
 */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The instant a `datetime-local` value names, built from the Date
 * constructor's local arguments rather than trusting `new Date(string)` to
 * read an offset-less string as local, which at least one engine has got
 * wrong. Null for a half-typed field, which leaves the filter alone.
 */
export function localInputToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// The dashboard

/** `0.826` → `83 %`. Rounded here, not by Intl, so the prerender and the browser agree. */
export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export interface OutcomeSegment {
  status: TaskHistoryStatus;
  count: number;
  /** Share of everything finished, 0–100. */
  pct: number;
}

/**
 * The dashboard's bar: everything finished in the window, by outcome. A
 * segment only for an outcome that occurred — a zero-width fill still renders
 * as a 2 px gap claiming a category.
 */
export function outcomeSegments(
  stats: Pick<TaskHistoryStats, "total" | "by_status">,
): OutcomeSegment[] {
  if (stats.total <= 0) return [];
  return (["COMPLETED", "FAILED", "CANCELED"] as const)
    .map((status) => ({ status, count: stats.by_status[status] }))
    .filter(({ count }) => count > 0)
    .map(({ status, count }) => ({ status, count, pct: (count / stats.total) * 100 }));
}

/**
 * The names the Name filter offers: every template and schedule template,
 * deduplicated and sorted, plus the current selection — so a name from a link
 * or a deleted template does not silently show as "All".
 */
export function historyNameOptions(
  templateNames: readonly string[],
  scheduleTemplateNames: readonly (string | null | undefined)[],
  selected: string | null,
): string[] {
  const names = new Set<string>();
  for (const name of templateNames) if (name) names.add(name);
  for (const name of scheduleTemplateNames) if (name) names.add(name);
  if (selected) names.add(selected);
  return [...names].sort((a, b) => a.localeCompare(b));
}
