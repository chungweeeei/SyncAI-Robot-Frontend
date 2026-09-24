import { describe, expect, it } from "vitest";

import {
  WEEKDAYS,
  describeNextRun,
  describeTrigger,
  formatLocalRunTime,
  formatUtcRunTime,
  fromCron,
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
