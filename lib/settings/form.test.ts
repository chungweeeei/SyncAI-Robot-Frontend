import { describe, expect, it } from "vitest";

import type { SettingField } from "@/lib/api/settings";
import {
  checkDraft,
  draftOf,
  formatValue,
  formatWithUnit,
  summarizeDrafts,
} from "@/lib/settings/form";

function field(over: Partial<SettingField> = {}): SettingField {
  return {
    id: "max_speed",
    group: "speed",
    label: "Maximum walking speed",
    description: "",
    kind: "number",
    unit: "m/s",
    min: 0.4,
    max: 1.0,
    step: 0.05,
    apply: "live",
    value: 0.8,
    current: 0.8,
    default: 0.8,
    modified: false,
    pending_restart: false,
    ...over,
  };
}

describe("formatValue", () => {
  it("drops float noise", () => {
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(3.81)).toBe("3.81");
  });

  it("is empty for an unknown value", () => {
    expect(formatValue(null)).toBe("");
  });

  it("puts the unit after a number", () => {
    expect(formatWithUnit(field(), 0.8)).toBe("0.8 m/s");
    expect(formatWithUnit(field({ unit: null }), 5)).toBe("5");
  });
});

describe("checkDraft", () => {
  it("reads a number within the limits", () => {
    expect(checkDraft(field(), " 0.6 ")).toEqual({ ok: true, value: 0.6 });
  });

  it.each([
    ["", "must be a number"],
    ["-", "must be a number"],
    ["0.", "at least 0.4 m/s"],
    ["fast", "must be a number"],
    ["1.2", "at most 1 m/s"],
  ])("refuses %j", (text, message) => {
    const check = checkDraft(field(), text);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain(message);
  });

  it("wants a whole number for an integer", () => {
    const integer = field({ kind: "integer", min: 1, max: 10 });
    expect(checkDraft(integer, "3")).toEqual({ ok: true, value: 3 });
    expect(checkDraft(integer, "3.5").ok).toBe(false);
  });

  it("takes a boolean as it is", () => {
    expect(checkDraft(field({ kind: "boolean" }), true)).toEqual({ ok: true, value: true });
  });
});

describe("summarizeDrafts", () => {
  const fields = [
    field(),
    field({ id: "accel", label: "Acceleration", value: 1.0, min: 0.3, max: 2.0, unit: "m/s²" }),
  ];

  it("sends only what differs from the robot's value", () => {
    expect(summarizeDrafts(fields, { max_speed: "0.6", accel: "1" })).toEqual({
      changes: { max_speed: 0.6 },
      invalid: {},
    });
  });

  it("holds an invalid draft back with its sentence", () => {
    const { changes, invalid } = summarizeDrafts(fields, { max_speed: "2", accel: "1.5" });
    expect(changes).toEqual({ accel: 1.5 });
    expect(invalid.max_speed).toContain("at most 1 m/s");
  });

  it("ignores a draft for a setting the robot no longer lists", () => {
    expect(summarizeDrafts(fields, { gone: "1" })).toEqual({ changes: {}, invalid: {} });
  });
});

describe("draftOf", () => {
  it("shows the typed text over the robot's value", () => {
    expect(draftOf(field(), { max_speed: "0." })).toBe("0.");
    expect(draftOf(field(), {})).toBe("0.8");
    expect(draftOf(field({ value: null }), {})).toBe("");
  });
});
