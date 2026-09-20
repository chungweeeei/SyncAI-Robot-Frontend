import { describe, expect, it } from "vitest";

import {
  formatCount,
  formatDuration,
  formatSize,
  formatTimestamp,
} from "@/lib/recording/format";

/**
 * These four are shared by the recorder panel and the bag list precisely so one
 * quantity never appears in two spellings, which is only true while they agree
 * on the edges.
 */
describe("formatDuration", () => {
  it("drops the hour until there is one", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(599)).toBe("9:59");
  });

  it("pads the minutes only once an hour is shown", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3661)).toBe("1:01:01");
    expect(formatDuration(36000)).toBe("10:00:00");
  });

  it("floors a fraction and refuses to go negative", () => {
    expect(formatDuration(9.99)).toBe("0:09");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("formatSize", () => {
  it("names the tier a bag actually lands in", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1 KiB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MiB");
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.0 GiB");
  });

  it("keeps a decimal under 10 MiB and drops it above", () => {
    // The point of the switch: 9.4 MiB is a number you compare, 437 MiB is a
    // number you glance at.
    expect(formatSize(Math.round(9.4 * 1024 * 1024))).toBe("9.4 MiB");
    expect(formatSize(Math.round(437.2 * 1024 * 1024))).toBe("437 MiB");
  });
});

describe("formatTimestamp", () => {
  it("shows UTC minutes, not the viewer's locale", () => {
    // Locale-dependent formatting would be a prerender/hydration mismatch, and
    // the bag directories are named in UTC anyway.
    expect(formatTimestamp("2026-09-18T09:22:41.500Z")).toBe("2026-09-18 09:22");
  });
});

describe("formatCount", () => {
  /**
   * U+2009, not a plain space, and spelled as an escape here so the
   * difference is visible: a regular space would wrap and would be a wider
   * gap than a tabular readout wants. A test that pasted the character would
   * pass against either and say nothing.
   */
  const THIN = "\u2009";

  it("groups from the right with thin spaces", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1585)).toBe(`1${THIN}585`);
    expect(formatCount(1234567)).toBe(`1${THIN}234${THIN}567`);
  });

  it("uses a non-breaking thin space, not an ASCII one", () => {
    expect(formatCount(1000)).not.toContain(" ");
  });
});
