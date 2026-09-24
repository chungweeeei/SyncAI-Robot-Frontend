import { describe, expect, it } from "vitest";

import type { ScheduleState } from "@/lib/api/schedule";
import {
  MAX_REFETCH_MS,
  OVERDUE_REFETCH_MS,
  RUN_REFETCH_SLACK_MS,
  WEEKDAYS,
  describeNextRun,
  describeTrigger,
  formatLocalRunTime,
  formatUtcRunTime,
  fromCron,
  nextScheduleRefetchMs,
  nextTimedRun,
  toCron,
} from "@/lib/task/schedule";

/**
 * The boundary these guard: the operator sees a time and some weekdays, the
 * backend sees a cron string, and neither side may ever see the other's
 * vocabulary. A cron this console cannot have written must still be shown,
 * but as itself — never as a sentence it does not mean.
 */
const ALL_DAYS = WEEKDAYS.map((day) => day.value);

describe("toCron", () => {
  it("writes every day as * and a subset as a sorted list", () => {
    expect(toCron({ hour: 9, minute: 0, days: ALL_DAYS })).toBe("0 9 * * *");
    expect(toCron({ hour: 21, minute: 30, days: [5, 1, 3] })).toBe(
      "30 21 * * 1,3,5",
    );
  });

  it("never emits a range, so one trigger has one spelling", () => {
    // 1-5 and 1,2,3,4,5 fire at the same moments; the console only ever
    // writes the second, so two equal schedules compare equal as strings.
    expect(toCron({ hour: 9, minute: 0, days: [1, 2, 3, 4, 5] })).toBe(
      "0 9 * * 1,2,3,4,5",
    );
  });

  it("collapses duplicate days rather than sending them twice", () => {
    expect(toCron({ hour: 0, minute: 0, days: [1, 1, 2] })).toBe("0 0 * * 1,2");
  });
});

describe("fromCron", () => {
  it("round-trips what toCron writes", () => {
    for (const days of [ALL_DAYS, [1, 2, 3, 4, 5], [0], [6, 0]]) {
      const timed = { hour: 7, minute: 45, days };
      expect(fromCron(toCron(timed))).toEqual({
        hour: 7,
        minute: 45,
        days: [...new Set(days)].sort((a, b) => a - b),
      });
    }
  });

  it("reads ranges and treats 7 as Sunday", () => {
    // Anything registered outside this console may use either spelling.
    expect(fromCron("0 9 * * 1-5")?.days).toEqual([1, 2, 3, 4, 5]);
    expect(fromCron("0 9 * * 7")?.days).toEqual([0]);
    expect(fromCron("0 9 * * 5-7")?.days).toEqual([0, 5, 6]);
  });

  it("refuses anything the picker could not have produced", () => {
    for (const cron of [
      "*/15 * * * *", // a step
      "0 9 1 * *", // a day of the month
      "0 9 * 6 *", // a month
      "0 9 * *", // four fields
      "0 9 * * 1 2026", // six fields
      "60 9 * * *", // out of range
      "0 9 * * 8", // not a day
      "0 9 * * 5-1", // backwards range
      "0 9 * * ", // empty day field
    ]) {
      expect(fromCron(cron), cron).toBeNull();
    }
  });
});

describe("describeTrigger", () => {
  it("says Daily, Weekdays, or the days themselves, never the cron", () => {
    expect(describeTrigger({ cron: "0 9 * * *" })).toBe("Daily at 09:00");
    expect(describeTrigger({ cron: "0 9 * * 1-5" })).toBe("Weekdays at 09:00");
    expect(describeTrigger({ cron: "5 18 * * 1,3,5" })).toBe(
      "Mon, Wed, Fri at 18:05",
    );
    expect(describeTrigger({ cron: "0 22 * * 6,0" })).toBe("Weekends at 22:00");
    expect(describeTrigger({ cron: "0 22 * * 0" })).toBe("Sun at 22:00");
  });

  it("appends the timezone the schedule was registered with", () => {
    expect(
      describeTrigger({ cron: "0 21 * * *", timezone: "Asia/Taipei" }),
    ).toBe("Daily at 21:00 · Asia/Taipei");
  });

  it("renders a cron it cannot express verbatim rather than misreading it", () => {
    expect(describeTrigger({ cron: "*/15 * * * *" })).toBe("*/15 * * * *");
    expect(
      describeTrigger({ cron: "*/15 * * * *", timezone: "UTC" }),
    ).toBe("*/15 * * * * · UTC");
  });

  it("keeps the interval wording", () => {
    expect(describeTrigger({ interval_seconds: 1800 })).toBe("every 30 min");
    expect(describeTrigger({ interval_seconds: 7200 })).toBe("every 2 h");
    expect(describeTrigger({ interval_seconds: 90 })).toBe("every 90 s");
    expect(describeTrigger({})).toBe("—");
  });
});

describe("nextTimedRun", () => {
  // Local-clock dates built from components, so the expectations hold in
  // whatever zone the test runner happens to be in.
  const wed = new Date(2026, 8, 23, 10, 30); // Wednesday 2026-09-23 10:30

  it("picks today when the time is still ahead, else the next allowed day", () => {
    expect(nextTimedRun({ hour: 11, minute: 0, days: [3] }, wed)).toEqual(
      new Date(2026, 8, 23, 11, 0),
    );
    expect(nextTimedRun({ hour: 9, minute: 0, days: [3] }, wed)).toEqual(
      new Date(2026, 8, 30, 9, 0),
    );
    expect(nextTimedRun({ hour: 9, minute: 0, days: [1, 2, 3, 4, 5] }, wed)).toEqual(
      new Date(2026, 8, 24, 9, 0),
    );
    expect(nextTimedRun({ hour: 9, minute: 0, days: [0, 6] }, wed)).toEqual(
      new Date(2026, 8, 26, 9, 0),
    );
  });

  it("treats the exact current minute as already gone", () => {
    expect(nextTimedRun({ hour: 10, minute: 30, days: [3] }, wed)).toEqual(
      new Date(2026, 8, 30, 10, 30),
    );
  });

  it("has nothing to say when no day is selected", () => {
    expect(nextTimedRun({ hour: 9, minute: 0, days: [] }, wed)).toBeNull();
  });
});

describe("describeNextRun", () => {
  const now = new Date(2026, 8, 23, 10, 30);

  it("says today and tomorrow, then the weekday", () => {
    expect(describeNextRun(new Date(2026, 8, 23, 11, 0), now)).toBe("today 11:00");
    expect(describeNextRun(new Date(2026, 8, 24, 9, 5), now)).toBe("tomorrow 09:05");
    expect(describeNextRun(new Date(2026, 8, 26, 9, 0), now)).toBe("Sat 09:00");
  });
});

describe("run time formatting", () => {
  it("formats the local clock from any ISO instant", () => {
    const local = new Date(2026, 8, 24, 9, 0);
    expect(formatLocalRunTime(local.toISOString())).toBe("2026-09-24 09:00");
  });

  it("hands back what it cannot parse rather than NaN", () => {
    expect(formatLocalRunTime("soon")).toBe("soon");
  });

  it("slices UTC without touching a clock", () => {
    expect(formatUtcRunTime("2026-09-24T01:00:00Z")).toBe("2026-09-24 01:00");
  });
});

describe("nextScheduleRefetchMs", () => {
  const now = Date.parse("2026-09-24T09:00:00Z");
  const schedule = (over: Partial<ScheduleState>): ScheduleState => ({
    id: "s",
    trigger: { interval_seconds: 3600 },
    paused: false,
    next_run_times: [],
    ...over,
  });

  it("reads once, just after the soonest run", () => {
    // Two rows; the later one must not be what sets the timer.
    const rows = [
      schedule({ id: "a", next_run_times: ["2026-09-24T10:00:00Z"] }),
      schedule({ id: "b", next_run_times: ["2026-09-24T09:05:00Z", "2026-09-24T09:10:00Z"] }),
    ];
    expect(nextScheduleRefetchMs(rows, now)).toBe(5 * 60_000 + RUN_REFETCH_SLACK_MS);
  });

  it("never polls with nothing to wait for", () => {
    // No schedules, a spec that can no longer fire, and a paused row whose
    // times are hidden anyway: none of them earns a request.
    expect(nextScheduleRefetchMs([], now)).toBe(false);
    expect(nextScheduleRefetchMs([schedule({ next_run_times: [] })], now)).toBe(false);
    expect(
      nextScheduleRefetchMs(
        [schedule({ paused: true, next_run_times: ["2026-09-24T09:05:00Z"] })],
        now,
      ),
    ).toBe(false);
  });

  it("backs off when the list still names a time that has passed", () => {
    // The robot missed its slot, or the browser's clock is ahead: re-reading
    // at once would loop as fast as the backend answers.
    const rows = [schedule({ next_run_times: ["2026-09-24T08:59:59Z"] })];
    expect(nextScheduleRefetchMs(rows, now)).toBe(OVERDUE_REFETCH_MS);
    expect(nextScheduleRefetchMs(rows, Date.parse("2026-09-24T08:59:59Z"))).toBe(
      OVERDUE_REFETCH_MS,
    );
  });

  it("caps a far-off run below the timer overflow", () => {
    const rows = [schedule({ next_run_times: ["2026-11-24T09:00:00Z"] })];
    expect(nextScheduleRefetchMs(rows, now)).toBe(MAX_REFETCH_MS);
    expect(MAX_REFETCH_MS).toBeLessThan(2 ** 31);
  });

  it("ignores a time it cannot parse rather than setting a NaN timer", () => {
    const rows = [
      schedule({ id: "bad", next_run_times: ["soon"] }),
      schedule({ id: "good", next_run_times: ["2026-09-24T09:01:00Z"] }),
    ];
    expect(nextScheduleRefetchMs(rows, now)).toBe(60_000 + RUN_REFETCH_SLACK_MS);
    expect(nextScheduleRefetchMs([rows[0]], now)).toBe(false);
  });
});
