import { describe, expect, it } from "vitest";

import type { TaskHistoryKindCount } from "@/lib/api/task";
import {
  DEFAULT_HISTORY_FILTER,
  chartRows,
  customRangeSeed,
  formatPercent,
  historyNameOptions,
  historyQueryKey,
  isoToLocalInput,
  kindLabel,
  localInputToIso,
  parseHistoryFilter,
  resolveTimeRange,
  runSeconds,
  serializeHistoryFilter,
  toHistoryQuery,
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

describe("chartRows", () => {
  const count = (over: Partial<TaskHistoryKindCount>): TaskHistoryKindCount => ({
    kind: "task",
    total: 0,
    completed: 0,
    failed: 0,
    canceled: 0,
    ...over,
  });

  it("orders rows by how many jobs they count", () => {
    const rows = chartRows([
      count({ kind: "task", total: 2, completed: 2 }),
      count({ kind: "goal", total: 5, completed: 4, failed: 1 }),
      count({ kind: "schedule", total: 3, canceled: 3 }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["goal", "schedule", "task"]);
  });

  it("the longest row is the full width and the others are its share", () => {
    const rows = chartRows([
      count({ kind: "goal", total: 4, completed: 4 }),
      count({ kind: "task", total: 1, completed: 1 }),
    ]);
    expect(rows[0].widthPct).toBe(100);
    expect(rows[1].widthPct).toBe(25);
  });

  it("leaves out a kind with nothing in the window rather than drawing an empty row", () => {
    const rows = chartRows([
      count({ kind: "goal", total: 1, completed: 1 }),
      count({ kind: "standup" }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["goal"]);
  });

  it("draws only the outcomes that happened, with shares that add up to the row", () => {
    const [row] = chartRows([count({ kind: "goal", total: 4, completed: 3, canceled: 1 })]);
    expect(row.segments.map((s) => s.status)).toEqual(["COMPLETED", "CANCELED"]);
    expect(row.segments.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
    expect(row.segments[0].pct).toBe(75);
  });

  it("labels the row of runs recorded without a kind, and never with a wire word", () => {
    const rows = chartRows([
      count({ kind: null, total: 2, canceled: 2 }),
      count({ kind: "liedown", total: 1, completed: 1 }),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["Other", "Lie"]);
    expect(rows[0].key).toBe("other");
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
