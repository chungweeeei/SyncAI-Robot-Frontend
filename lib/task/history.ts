// The job history's rules: a run's duration arithmetic, the filter the screen
// offers and how it travels (to the backend as a query, to the address bar as
// search params), and the arithmetic behind the dashboard above the list.
// React-free so each rule can be tested without a page, and kept apart from
// lib/api/task.ts because none of it is a request.

import type {
  TaskHistoryFilterQuery,
  TaskHistoryKind,
  TaskHistoryKindCount,
  TaskHistoryStatus,
} from "@/lib/api/task";

/**
 * Seconds between a run's start and its close, both server timestamps, or null
 * when the close time is missing.
 *
 * Null rather than 0: zero seconds is a claim about the run, and a row with no
 * close time has made no such claim. A negative span (clock skew inside the
 * backend) clamps to zero instead of rendering as a minus sign.
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

/**
 * The last day, every outcome, every kind. A plain `/history` is this, so the
 * default is also what "clear the filters" means.
 */
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

const KIND_LABEL: Record<TaskHistoryKind, string> = {
  goal: "Navigation goal",
  standup: "Stand",
  liedown: "Lie",
  task: "Task",
  schedule: "Scheduled",
};

/**
 * What a kind is called on screen. The wire words (`goal`, `standup`, …) are
 * the id's vocabulary and never the operator's; a kind this build does not
 * know, and a run recorded without one, are both "Other" — a label that makes
 * no claim about what the run was.
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
 * A preset is `since` only, on purpose: a job that finishes while the page is
 * open must land inside the window, so that the refresh the active-task poll
 * triggers can show it. An `until` of "now" would exclude every one of them.
 * `nowMs` is handed in rather than read, so the caller decides when the window
 * is anchored — see useHistoryFilter for why that is not every render.
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

/** The wire filter for one screen filter — what both history reads are keyed and fetched by. */
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
 * A canonical string for a wire filter, in a fixed field order, so two objects
 * that ask for the same runs make the same query key whatever order their keys
 * were written in. JSON so a name containing any separator stays unambiguous.
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

/** Is `iso` a time `Date` can read? The bounds in a custom range must be, or the backend answers 422. */
function isIsoTime(value: string | null): value is string {
  return value !== null && !Number.isNaN(Date.parse(value));
}

/**
 * The filter a `/history?…` address names. Tolerant field by field: a value
 * this build cannot read falls back to that field's default rather than
 * refusing the whole address, so a bookmark made under an older build still
 * opens on something sensible.
 *
 * Search params: `status`, `range` (a preset, or `custom` with `from` and
 * `to` as ISO 8601 UTC), `kind`, `name`. A custom range missing a bound, or
 * ending before it starts, is not a window and falls back to the default.
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

/**
 * The address for a filter. Defaults are left out, so a plain `/history` stays
 * plain and only what the operator changed is in the link they copy.
 */
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
 * The bounds a custom range starts from when the operator picks "Custom": the
 * window they were already looking at, closed at now, so the two inputs are
 * never blank and changing one of them is a refinement of what was on screen.
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
 * An ISO 8601 instant as `<input type="datetime-local">` wants it, in this
 * runtime's clock — the same trade formatLocalRunTime makes: `Date`'s local
 * getters, never Intl, so the string is the operator's wall clock and nothing
 * in it depends on a locale. Empty for a time `Date` cannot read.
 */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The instant a `datetime-local` value names, read in this runtime's clock
 * through the Date constructor's local arguments — explicitly, rather than
 * trusting `new Date(string)` to treat an offset-less string as local, which
 * the spec says and at least one engine has got wrong. Null for a value that
 * is not a time, so a half-typed field leaves the filter alone.
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

export interface HistoryChartSegment {
  status: TaskHistoryStatus;
  count: number;
  /** Share of this row, 0–100. */
  pct: number;
}

export interface HistoryChartRow {
  /** The row's identity for React — the wire kind, or "other" for the null row. */
  key: string;
  label: string;
  total: number;
  /**
   * Share of the longest row, 0–100: bar length reads as magnitude across
   * rows, which is the one thing a stacked bar is for.
   */
  widthPct: number;
  /** Only the outcomes that happened, in Completed / Failed / Canceled order. */
  segments: HistoryChartSegment[];
}

/**
 * The dashboard's bars from the backend's per-kind counts: busiest kind first,
 * a kind with nothing in the window left out rather than drawn as an empty
 * row, and a segment only for an outcome that occurred — a zero-width fill is
 * not nothing, it is a 2 px gap claiming a category.
 */
export function chartRows(byKind: readonly TaskHistoryKindCount[]): HistoryChartRow[] {
  const rows = byKind.filter((row) => row.total > 0);
  const longest = rows.reduce((max, row) => Math.max(max, row.total), 0);
  return rows
    .map((row) => ({
      key: row.kind ?? "other",
      label: kindLabel(row.kind),
      total: row.total,
      widthPct: longest ? (row.total / longest) * 100 : 0,
      segments: (
        [
          ["COMPLETED", row.completed],
          ["FAILED", row.failed],
          ["CANCELED", row.canceled],
        ] as const
      )
        .filter(([, count]) => count > 0)
        .map(([status, count]) => ({
          status,
          count,
          pct: (count / row.total) * 100,
        })),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * The names the Name filter offers: every template on the robot and every
 * schedule's template, deduplicated and sorted — plus whatever is already
 * selected, so a name reached through a link, or whose template was since
 * deleted, keeps its place in the picker instead of silently showing "All".
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
