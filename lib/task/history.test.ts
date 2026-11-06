import { describe, expect, it } from "vitest";

import {
  DEFAULT_HISTORY_FILTER,
  DEFAULT_HISTORY_PAGE_SIZE,
  continuationKind,
  continuationBlocked,
  continuationStart,
  customRangeSeed,
  countReportJobs,
  dateInputValue,
  describeExportWindow,
  describeRun,
  exportDatesSeed,
  exportFilename,
  formatPercent,
  historyNameOptions,
  historyPageWindow,
  historyQueryKey,
  historySearch,
  isDefaultHistoryFilter,
  isoToLocalInput,
  kindLabel,
  localInputToIso,
  matchingTotal,
  outcomeSegments,
  parseHistoryFilter,
  parseHistoryPageSize,
  resolveTimeRange,
  runSeconds,
  serializeHistoryFilter,
  stepSeconds,
  toExportQuery,
  toHistoryQuery,
  toHistoryStatsQuery,
  type HistoryFilter,
} from "@/lib/task/history";

/**
 * The boundaries these guard: the backend counts what the filter names and
 * the list shows the same rows, so the two reads must ask for the same thing;
 * the address bar carries the filter, so it must survive a round trip; and
 * what the operator reads must never be the wire's vocabulary.
 */

describe("runSeconds", () => {
  it("is null, not zero, when the run has no close time", () => {
    expect(runSeconds("2026-09-18T09:40:00Z", null)).toBeNull();
  });

  it("measures between the two server timestamps", () => {
    expect(runSeconds("2026-09-18T09:40:00Z", "2026-09-18T09:44:12Z")).toBe(252);
  });

  it("never reports a negative duration", () => {
    expect(runSeconds("2026-09-18T09:40:05Z", "2026-09-18T09:40:00Z")).toBe(0);
  });
});

describe("stepSeconds", () => {
  it("is the wall time less the hold", () => {
    expect(
      stepSeconds({
        started_at: "2026-09-18T09:40:00Z",
        ended_at: "2026-09-18T09:42:00Z",
        paused_seconds: 30.4,
      }),
    ).toEqual({ active: 89, paused: 30 });
  });

  it("is null, not zero, for a step that has not both started and ended", () => {
    expect(stepSeconds({ started_at: "2026-09-18T09:40:00Z", ended_at: null })).toBeNull();
    expect(stepSeconds({ started_at: null, ended_at: null })).toBeNull();
    // An older backend sends neither.
    expect(stepSeconds({})).toBeNull();
  });

  it("never reports a negative duration", () => {
    expect(
      stepSeconds({ started_at: "2026-09-18T09:40:05Z", ended_at: "2026-09-18T09:40:00Z" }),
    ).toEqual({ active: 0, paused: 0 });
  });
});

describe("exportFilename", () => {
  // Midday, so the operator's calendar day is the UTC one in any test zone.
  const noon = Date.parse("2026-10-31T12:00:00Z");

  it("names the window's two days", () => {
    expect(
      exportFilename(
        { since: "2026-10-01T12:00:00Z", until: "2026-10-30T12:00:00Z" },
        noon,
      ),
    ).toBe("task-report-20261001-20261030.csv");
  });

  it("runs a preset's window to now", () => {
    expect(exportFilename({ since: "2026-10-30T12:00:00Z" }, noon)).toBe(
      "task-report-20261030-20261031.csv",
    );
  });

  it("is just today without a since", () => {
    expect(exportFilename({}, noon)).toBe("task-report-20261031.csv");
  });
});

const now = Date.parse("2026-09-18T10:00:00Z");

describe("resolveTimeRange", () => {
  it("a preset is since-only, so a job finishing later still lands inside it", () => {
    const range = resolveTimeRange({ preset: "24h" }, now);
    expect(range.since).toBe("2026-09-17T10:00:00.000Z");
    expect(range.until).toBeUndefined();
  });

  it("reaches back from the now it is given, not the clock", () => {
    expect(resolveTimeRange({ preset: "6h" }, now).since).toBe("2026-09-18T04:00:00.000Z");
    expect(resolveTimeRange({ preset: "1h" }, now).since).toBe("2026-09-18T09:00:00.000Z");
  });

  it("sends a custom range's two bounds unchanged", () => {
    const from = "2026-09-18T01:00:00.000Z";
    const to = "2026-09-18T09:30:00.000Z";
    expect(resolveTimeRange({ from, to }, now)).toEqual({ since: from, until: to });
  });
});

describe("toHistoryQuery", () => {
  it("leaves out every field the operator did not narrow", () => {
    const query = toHistoryQuery(DEFAULT_HISTORY_FILTER, now);
    expect(query).toEqual({
      status: undefined,
      since: "2026-09-17T10:00:00.000Z",
      until: undefined,
      kind: undefined,
      name: undefined,
    });
  });

  it("carries a full filter through", () => {
    const filter: HistoryFilter = {
      status: "FAILED",
      range: { from: "2026-09-18T01:00:00.000Z", to: "2026-09-18T09:00:00.000Z" },
      kind: "schedule",
      name: "Morning round",
    };
    expect(toHistoryQuery(filter, now)).toEqual({
      status: "FAILED",
      since: "2026-09-18T01:00:00.000Z",
      until: "2026-09-18T09:00:00.000Z",
      kind: "schedule",
      name: "Morning round",
    });
  });
});

describe("toHistoryStatsQuery", () => {
  it("counts the whole window whatever outcome is picked, so the tiles stay pickable", () => {
    const filter: HistoryFilter = { ...DEFAULT_HISTORY_FILTER, status: "FAILED", kind: "goal" };
    const stats = toHistoryStatsQuery(filter, now);
    expect(stats.status).toBeUndefined();
    expect(stats.kind).toBe("goal");
    expect(stats.since).toBe(toHistoryQuery(filter, now).since);
  });
});

describe("isDefaultHistoryFilter", () => {
  it("is true only for what a plain address shows", () => {
    expect(isDefaultHistoryFilter(DEFAULT_HISTORY_FILTER)).toBe(true);
    expect(isDefaultHistoryFilter({ ...DEFAULT_HISTORY_FILTER, status: "FAILED" })).toBe(false);
    expect(isDefaultHistoryFilter({ ...DEFAULT_HISTORY_FILTER, range: { preset: "1h" } })).toBe(
      false,
    );
  });
});

describe("describeRun", () => {
  const run = (over: Partial<Parameters<typeof describeRun>[0]>) => ({
    id: "robot01-task-1758000000-1",
    kind: "task",
    name: null,
    schedule_id: null,
    ...over,
  });

  it("calls a job by its template's name first", () => {
    expect(describeRun(run({ name: "Morning round" }))).toEqual({
      title: "Morning round",
      detail: "Task · Started directly",
    });
    expect(
      describeRun(run({ name: "Night watch", kind: "schedule", schedule_id: "nightly" })),
    ).toEqual({ title: "Night watch", detail: "Scheduled · nightly" });
  });

  it("falls back to the kind, in the operator's words", () => {
    expect(describeRun(run({ kind: "goal" }))).toEqual({
      title: "Navigation goal",
      detail: "Started directly",
    });
    expect(describeRun(run({ kind: "liedown" })).title).toBe("Lie down");
  });

  it("names a nameless scheduled run by its schedule", () => {
    expect(describeRun(run({ kind: "schedule", schedule_id: "nightly" }))).toEqual({
      title: "nightly",
      detail: "Scheduled",
    });
  });

  it("shows the id only for a run nothing labelled", () => {
    expect(describeRun(run({ kind: null }))).toEqual({
      title: "robot01-task-1758000000-1",
      detail: "Started directly",
    });
    expect(describeRun(run({ kind: "warp" })).title).toBe("robot01-task-1758000000-1");
  });
});

describe("historyQueryKey", () => {
  it("gives the same filter the same key whatever the object's key order", () => {
    const a = historyQueryKey({ name: "x", kind: "goal", since: "s", status: "FAILED" });
    const b = historyQueryKey({ status: "FAILED", since: "s", kind: "goal", name: "x" });
    expect(a).toBe(b);
  });

  it("tells two filters apart that differ in one field", () => {
    expect(historyQueryKey({ since: "s" })).not.toBe(historyQueryKey({ since: "s", until: "u" }));
    expect(historyQueryKey({ name: "a" })).not.toBe(historyQueryKey({ name: "b" }));
  });

  it("is unambiguous for a name containing any separator", () => {
    expect(historyQueryKey({ since: '"|,', name: "" })).not.toBe(
      historyQueryKey({ since: "", name: '"|,' }),
    );
    expect(historyQueryKey({ since: "a", until: "b" })).not.toBe(
      historyQueryKey({ since: "a,b", until: "" }),
    );
  });
});

describe("parseHistoryFilter / serializeHistoryFilter", () => {
  const parse = (query: string) => parseHistoryFilter(new URLSearchParams(query));

  it("a plain address is the default filter", () => {
    expect(parse("")).toEqual(DEFAULT_HISTORY_FILTER);
  });

  it("round-trips every field", () => {
    const filter: HistoryFilter = {
      status: "CANCELED",
      range: { from: "2026-09-18T01:00:00.000Z", to: "2026-09-18T09:00:00.000Z" },
      kind: "liedown",
      name: "Night watch & more",
    };
    expect(parse(serializeHistoryFilter(filter).toString())).toEqual(filter);

    const preset: HistoryFilter = { ...DEFAULT_HISTORY_FILTER, range: { preset: "6h" } };
    expect(parse(serializeHistoryFilter(preset).toString())).toEqual(preset);
  });

  it("omits defaults so the address stays short", () => {
    expect(serializeHistoryFilter(DEFAULT_HISTORY_FILTER).toString()).toBe("");
    expect(
      serializeHistoryFilter({ ...DEFAULT_HISTORY_FILTER, status: "FAILED" }).toString(),
    ).toBe("status=FAILED");
  });

  it("falls back to the default for a preset, status or kind it does not know", () => {
    expect(parse("range=7d&status=RUNNING&kind=warp")).toEqual(DEFAULT_HISTORY_FILTER);
  });

  it("a custom range with one bound missing, or ending before it starts, falls back to the default range", () => {
    expect(parse("range=custom&from=2026-09-18T01:00:00.000Z").range).toEqual(
      DEFAULT_HISTORY_FILTER.range,
    );
    expect(
      parse("range=custom&from=2026-09-18T09:00:00.000Z&to=2026-09-18T01:00:00.000Z").range,
    ).toEqual(DEFAULT_HISTORY_FILTER.range);
    expect(parse("range=custom&from=yesterday&to=today").range).toEqual(
      DEFAULT_HISTORY_FILTER.range,
    );
  });

  it("treats an empty name as no name", () => {
    expect(parse("name=").name).toBeNull();
  });
});

describe("the page size", () => {
  const parse = (query: string) => parseHistoryPageSize(new URLSearchParams(query));

  it("reads one of the offered sizes, else the default", () => {
    expect(parse("size=25")).toBe(25);
    expect(parse("")).toBe(DEFAULT_HISTORY_PAGE_SIZE);
    // The backend would take 37; the picker could not show it.
    expect(parse("size=37")).toBe(DEFAULT_HISTORY_PAGE_SIZE);
    expect(parse("size=many")).toBe(DEFAULT_HISTORY_PAGE_SIZE);
  });

  it("rides beside the filter in the address, left out at its default", () => {
    const filter: HistoryFilter = { ...DEFAULT_HISTORY_FILTER, status: "FAILED" };
    expect(historySearch(filter, DEFAULT_HISTORY_PAGE_SIZE)).toBe("status=FAILED");
    const search = new URLSearchParams(historySearch(filter, 50));
    expect(parseHistoryFilter(search)).toEqual(filter);
    expect(parseHistoryPageSize(search)).toBe(50);
  });

  it("is not part of the filter, so clearing the filters keeps it", () => {
    expect(historySearch(DEFAULT_HISTORY_FILTER, 25)).toBe("size=25");
    expect(isDefaultHistoryFilter(DEFAULT_HISTORY_FILTER)).toBe(true);
  });
});

describe("matchingTotal", () => {
  const stats = {
    as_of: "2026-09-18T10:00:00Z",
    total: 47,
    by_status: { COMPLETED: 40, FAILED: 5, CANCELED: 2 },
    success_rate: 40 / 47,
  };

  it("is the window's total, or one outcome's tile when the list is narrowed to it", () => {
    expect(matchingTotal(stats, "ALL")).toBe(47);
    expect(matchingTotal(stats, "FAILED")).toBe(5);
  });

  it("is unknown before the counts arrive, never 0", () => {
    expect(matchingTotal(null, "ALL")).toBeNull();
  });
});

describe("historyPageWindow", () => {
  it("places a page in the whole", () => {
    expect(
      historyPageWindow({ page: 2, pageSize: 10, shown: 10, total: 47, hasNext: true }),
    ).toEqual({ from: 11, to: 20, total: 47, pageCount: 5 });
    expect(
      historyPageWindow({ page: 5, pageSize: 10, shown: 7, total: 47, hasNext: false }),
    ).toEqual({ from: 41, to: 47, total: 47, pageCount: 5 });
  });

  it("still gives the rows' span while the count is unknown", () => {
    expect(
      historyPageWindow({ page: 2, pageSize: 10, shown: 10, total: null, hasNext: true }),
    ).toEqual({ from: 11, to: 20, total: null, pageCount: null });
  });

  it("drops a count the rows contradict rather than show it", () => {
    // A job finished after the counts were read: more rows than the total.
    expect(
      historyPageWindow({ page: 3, pageSize: 10, shown: 10, total: 25, hasNext: true }).total,
    ).toBeNull();
    // The list has ended, yet the count claims more.
    expect(
      historyPageWindow({ page: 1, pageSize: 10, shown: 7, total: 9, hasNext: false }).total,
    ).toBeNull();
  });

  it("takes a cursor handed at a page boundary as the end it turns out to be", () => {
    expect(
      historyPageWindow({ page: 2, pageSize: 10, shown: 10, total: 20, hasNext: true }),
    ).toEqual({ from: 11, to: 20, total: 20, pageCount: 2 });
    // …and the empty page after it.
    expect(
      historyPageWindow({ page: 3, pageSize: 10, shown: 0, total: 20, hasNext: false }),
    ).toEqual({ from: 0, to: 20, total: 20, pageCount: 3 });
  });
});

describe("customRangeSeed", () => {
  it("opens on the window the operator was already looking at, closed at now", () => {
    expect(customRangeSeed({ preset: "6h" }, now)).toEqual({
      from: "2026-09-18T04:00:00.000Z",
      to: "2026-09-18T10:00:00.000Z",
    });
  });

  it("keeps a custom range as it is", () => {
    const range = { from: "2026-09-18T01:00:00.000Z", to: "2026-09-18T02:00:00.000Z" };
    expect(customRangeSeed(range, now)).toEqual(range);
  });
});

describe("datetime-local conversion", () => {
  it("reads a datetime-local value as the runtime's clock", () => {
    // Whatever zone the test runs in, the constructor's local arguments and
    // the input's fields name the same wall-clock moment.
    const expected = new Date(2026, 8, 18, 9, 30).toISOString();
    expect(localInputToIso("2026-09-18T09:30")).toBe(expected);
    expect(localInputToIso("2026-09-18T09:30:15")).toBe(
      new Date(2026, 8, 18, 9, 30, 15).toISOString(),
    );
  });

  it("rejects a value that is not a time with null, not an Invalid Date", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-09-18")).toBeNull();
    expect(localInputToIso("soon")).toBeNull();
  });

  it("round-trips through the input's shape", () => {
    const iso = new Date(2026, 8, 18, 9, 30).toISOString();
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(isoToLocalInput("not a time")).toBe("");
  });
});

describe("kindLabel", () => {
  it("never shows the id's wire words", () => {
    // "task" reads as a word already; the other three are the id's spellings
    // and not anything an operator says.
    for (const kind of ["goal", "standup", "liedown", "schedule"]) {
      expect(kindLabel(kind).toLowerCase()).not.toBe(kind);
    }
    expect(kindLabel("goal")).toBe("Navigation goal");
    expect(kindLabel("schedule")).toBe("Scheduled");
    expect(kindLabel("task")).toBe("Task");
  });

  it("calls a kind it does not know, or none, Other", () => {
    expect(kindLabel(null)).toBe("Other");
    expect(kindLabel("warp")).toBe("Other");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0.8268)).toBe("83 %");
    expect(formatPercent(1)).toBe("100 %");
    expect(formatPercent(0)).toBe("0 %");
  });
});

describe("outcomeSegments", () => {
  it("draws only the outcomes that happened, with shares that add up to the whole", () => {
    const segments = outcomeSegments({
      total: 4,
      by_status: { COMPLETED: 3, FAILED: 0, CANCELED: 1 },
    });
    expect(segments.map((s) => s.status)).toEqual(["COMPLETED", "CANCELED"]);
    expect(segments.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
    expect(segments[0].pct).toBe(75);
  });

  it("is nothing, not three empty segments, when nothing finished", () => {
    expect(
      outcomeSegments({ total: 0, by_status: { COMPLETED: 0, FAILED: 0, CANCELED: 0 } }),
    ).toEqual([]);
  });
});

describe("historyNameOptions", () => {
  it("merges templates and schedules, deduplicated and sorted", () => {
    expect(
      historyNameOptions(["Night watch", "Morning round"], ["Morning round", null, undefined], null),
    ).toEqual(["Morning round", "Night watch"]);
  });

  it("keeps the selected name even when nothing lists it", () => {
    expect(historyNameOptions(["Night watch"], [], "Gone template")).toEqual([
      "Gone template",
      "Night watch",
    ]);
  });
});

describe("the report's window", () => {
  // Local noon on 2026-11-01, so calendar days are the same in any test zone.
  const today = new Date(2026, 10, 1, 12, 0).getTime();
  const localMidnight = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d).toISOString();
  const narrowed: HistoryFilter = {
    ...DEFAULT_HISTORY_FILTER,
    status: "FAILED",
    kind: "task",
    name: "Patrol",
  };

  it("the last N days are whole calendar days, today included, open at now", () => {
    const week = toExportQuery(narrowed, "7d", exportDatesSeed(today), today);
    expect(week).toEqual({
      status: "FAILED",
      kind: "task",
      name: "Patrol",
      since: localMidnight(2026, 10, 26),
      until: undefined,
    });
    expect(toExportQuery(narrowed, "30d", exportDatesSeed(today), today)?.since).toBe(
      localMidnight(2026, 10, 3),
    );
  });

  it("picked dates cover both whole days", () => {
    const query = toExportQuery(
      DEFAULT_HISTORY_FILTER,
      "custom",
      { from: "2026-10-10", to: "2026-10-12" },
      today,
    );
    expect(query?.since).toBe(localMidnight(2026, 10, 10));
    expect(Date.parse(query!.until!)).toBe(Date.parse(localMidnight(2026, 10, 13)) - 1);
  });

  it("refuses reversed or half-typed dates", () => {
    const dates = (from: string, to: string) =>
      toExportQuery(DEFAULT_HISTORY_FILTER, "custom", { from, to }, today);
    expect(dates("2026-10-12", "2026-10-10")).toBeNull();
    expect(dates("", "2026-10-10")).toBeNull();
  });

  it("seeds the dates with the last 7 days", () => {
    expect(exportDatesSeed(today)).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(dateInputValue(today)).toBe("2026-11-01");
  });

  it("describes the window by its days", () => {
    expect(
      describeExportWindow({ since: localMidnight(2026, 10, 26) }, today),
    ).toBe("2026-10-26 → 2026-11-01");
    expect(describeExportWindow({ since: localMidnight(2026, 11, 1) }, today)).toBe(
      "2026-11-01",
    );
    expect(describeExportWindow({}, today)).toBe("up to 2026-11-01");
  });
});

describe("countReportJobs", () => {
  const header =
    "\ufefftask_id,run_id,task_name,kind,schedule_id,map_name,task_status,error_msg\r\n";

  it("counts runs, not steps", () => {
    const csv =
      header +
      "t1,run-a,,,,,COMPLETED,\r\n" +
      "t1,run-a,,,,,COMPLETED,\r\n" +
      "t2,run-b,,,,,FAILED,boom\r\n";
    expect(countReportJobs(csv)).toBe(2);
  });

  it("reads quoted commas, quotes and newlines as one field", () => {
    const csv =
      header +
      't1,run-a,"Patrol, east",,,,FAILED,"said ""no""\nthen stopped"\r\n' +
      "t2,run-b,,,,,COMPLETED,\r\n";
    expect(countReportJobs(csv)).toBe(2);
  });

  it("is 0 for a header-only report", () => {
    expect(countReportJobs(header)).toBe(0);
    expect(countReportJobs("")).toBe(0);
  });
});


describe("continuationStart", () => {
  const step = (id: string, status: string, group: string | null = null) =>
    ({ id, status, group }) as { id: string; status: "FAILED"; group: string | null };

  it("is the failed step when it ran on its own", () => {
    expect(
      continuationStart([step("1-move", "COMPLETED"), step("2-move", "FAILED")]),
    ).toEqual({ id: "2-move", ordinal: 2 });
  });

  it("is the first of the failed step's group, since a group runs together", () => {
    expect(
      continuationStart([
        step("1-standup", "COMPLETED"),
        step("2-speak", "CANCELED", "g"),
        step("3-move", "FAILED", "g"),
        step("4-wait", "PENDING"),
      ]),
    ).toEqual({ id: "2-speak", ordinal: 2 });
  });

  it("does not reach into a group that only shares the name further up", () => {
    expect(
      continuationStart([
        step("1-speak", "COMPLETED", "g"),
        step("2-standup", "COMPLETED"),
        step("3-move", "FAILED", "g"),
      ]),
    ).toEqual({ id: "3-move", ordinal: 3 });
  });

  it("is null when no step failed, which the backend refuses", () => {
    expect(continuationStart([step("1-move", "CANCELED")])).toBeNull();
    expect(continuationStart([])).toBeNull();
  });
});

describe("continuationKind", () => {
  it("keeps the failed job's own kind", () => {
    expect(continuationKind("goal")).toBe("goal");
    expect(continuationKind("task")).toBe("task");
  });

  it("sends a schedule's, or an unknown one, as a task: the backend refuses 'schedule'", () => {
    expect(continuationKind("schedule")).toBe("task");
    expect(continuationKind(null)).toBe("task");
    expect(continuationKind("newer-kind")).toBe("task");
  });
});

describe("continuationBlocked", () => {
  const clear = { robotId: "robot01", stopped: false, listReadable: true, running: false };

  it("lets a continuation through when nothing stands in its way", () => {
    expect(continuationBlocked(clear)).toBeNull();
  });

  it("says the first thing the robot would refuse it for", () => {
    expect(continuationBlocked({ ...clear, robotId: null, stopped: true })).toBe(
      "The robot cannot be reached.",
    );
    expect(continuationBlocked({ ...clear, stopped: true, running: true })).toBe(
      "The emergency stop is engaged.",
    );
    expect(continuationBlocked({ ...clear, listReadable: false, running: true })).toBe(
      "Whether a job is running cannot be read.",
    );
    expect(continuationBlocked({ ...clear, running: true })).toBe(
      "Another job is running; it has to finish first.",
    );
  });
});
