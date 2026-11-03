// The controller settings form's rules, React-free: what a typed value means,
// whether it is in the robot's limits, and which settings a Save sends.
//
// The robot validates every change again (ranges, and the rules that tie one
// setting to another, which only it can judge), so these checks exist to
// grey Save and say "at most 1.0 m/s" before a round trip, not to be the gate.

import type { SettingField, SettingValue } from "@/lib/api/settings";

/** What the operator has typed or switched, by setting id. Text for numbers. */
export type SettingDrafts = Record<string, string | boolean>;

/** A value as the form's input shows it. */
export function formatValue(value: SettingValue | null): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "On" : "Off";
  // Up to the precision a step can reach, without trailing float noise
  // (0.1 + 0.2 must not read 0.30000000000000004).
  return String(Number(value.toPrecision(12)));
}

/** A value with its unit, for "Default 0.8 m/s". */
export function formatWithUnit(field: SettingField, value: SettingValue | null): string {
  const text = formatValue(value);
  return field.unit && typeof value === "number" ? `${text} ${field.unit}` : text;
}

export type DraftCheck =
  | { ok: true; value: SettingValue }
  | { ok: false; message: string };

/** What a draft means for its setting, or why it cannot be sent. */
export function checkDraft(field: SettingField, draft: string | boolean): DraftCheck {
  if (field.kind === "boolean") {
    return typeof draft === "boolean"
      ? { ok: true, value: draft }
      : { ok: false, message: `${field.label} must be on or off.` };
  }

  const text = typeof draft === "string" ? draft.trim() : "";
  // Number("") is 0 and Number(" ") too; an empty field is not a zero.
  const value = text === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `${field.label} must be a number.` };
  }
  if (field.kind === "integer" && !Number.isInteger(value)) {
    return { ok: false, message: `${field.label} must be a whole number.` };
  }
  const unit = field.unit ? ` ${field.unit}` : "";
  if (field.min !== null && value < field.min) {
    return { ok: false, message: `${field.label} must be at least ${field.min}${unit}.` };
  }
  if (field.max !== null && value > field.max) {
    return { ok: false, message: `${field.label} must be at most ${field.max}${unit}.` };
  }
  return { ok: true, value };
}

function same(a: SettingValue | null, b: SettingValue): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

export interface DraftSummary {
  /** The settings a Save sends: valid drafts that differ from the robot's value. */
  changes: Record<string, SettingValue>;
  /** Why a draft cannot be sent, by setting id. */
  invalid: Record<string, string>;
}

/**
 * Sort the drafts into what a Save sends and what blocks it. A draft equal to
 * the robot's value is no change: typing a number back to what it was must
 * not leave Save lit, or send a write that does nothing.
 */
export function summarizeDrafts(fields: SettingField[], drafts: SettingDrafts): DraftSummary {
  const changes: Record<string, SettingValue> = {};
  const invalid: Record<string, string> = {};
  for (const field of fields) {
    const draft = drafts[field.id];
    if (draft === undefined) continue;
    const check = checkDraft(field, draft);
    if (!check.ok) {
      invalid[field.id] = check.message;
    } else if (field.value === null || !same(field.value, check.value)) {
      changes[field.id] = check.value;
    }
  }
  return { changes, invalid };
}

/** A setting's draft as the input shows it: the typed text, else the robot's value. */
export function draftOf(field: SettingField, drafts: SettingDrafts): string | boolean {
  const draft = drafts[field.id];
  if (draft !== undefined) return draft;
  if (field.kind === "boolean") return field.value === true;
  return formatValue(field.value);
}
