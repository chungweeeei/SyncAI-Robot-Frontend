// How a registered trigger is written for an operator, and how the timed
// trigger the form offers becomes the cron string the backend wants.
//
// This lived inside schedule-list.tsx, with a note saying a lib module holding
// one formatter would be a file whose header has nothing to say. It has
// something to say now: the template library also has to render a trigger, so
// that a row can be told apart from a one-time task at a glance, and two copies
// of "every 30 min" would drift the first time the wording changed.
//
// Cron itself never reaches the screen. The backend's timed trigger *is* a cron
// expression, and a scheduler needs one, but "0 9 * * 1-5" is a sentence for
// the people who built the stack, not for the operator registering a patrol.
// The form only ever offers a time of day and a set of weekdays, so this module
// owns both directions: the single canonical cron the picker can produce, and
// the reading back of any cron that stays inside that vocabulary. One written
// outside it (a `*/15`, a day of the month) is shown verbatim rather than
// misdescribed — a wrong sentence about when a robot moves is worse than an
// opaque one.

import type { ScheduleState, ScheduleTrigger } from "@/lib/api/schedule";

/**
 * The seven days in the order an operator expects them, each with its cron
 * day-of-week number. Cron counts from Sunday, so Sunday is 0 and last.
 */
export const WEEKDAYS: readonly { value: number; short: string; long: string }[] = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
];

const WEEKDAY_VALUES: readonly number[] = [1, 2, 3, 4, 5];

/** The only timed trigger the picker can express: a clock time on some days. */
export interface TimeOfDay {
  hour: number;
  minute: number;
  /** Cron day-of-week numbers, Sunday = 0. Order and duplicates do not matter. */
  days: readonly number[];
}

function sortedUniqueDays(days: readonly number[]): number[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

/**
 * `{ hour: 9, minute: 0, days: [1..5] }` → `0 9 * * 1,2,3,4,5`.
 *
 * All seven days write `*` and anything less writes a sorted comma list. Ranges
 * are never emitted, so every trigger the console registers has exactly one
 * spelling and two schedules that fire at the same moments compare equal.
 */
export function toCron({ hour, minute, days }: TimeOfDay): string {
  const unique = sortedUniqueDays(days);
  const dow = unique.length === 7 ? "*" : unique.join(",");
  return `${minute} ${hour} * * ${dow}`;
}

function parseField(field: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(field)) return null;
  const value = Number(field);
  return value <= max ? value : null;
}

/**
 * Read a day-of-week field back: `*`, a comma list, or `a-b` ranges over 0–7.
 * Cron lets both 0 and 7 mean Sunday, so 7 is folded into 0.
 */
function parseDays(field: string): number[] | null {
  if (field === "*") return sortedUniqueDays(WEEKDAYS.map((day) => day.value));
  const days: number[] = [];
  for (const part of field.split(",")) {
    const range = /^(\d)(?:-(\d))?$/.exec(part);
    if (!range) return null;
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (from > 7 || to > 7 || from > to) return null;
    for (let day = from; day <= to; day++) days.push(day === 7 ? 0 : day);
  }
  return days.length ? sortedUniqueDays(days) : null;
}

/**
 * The inverse of `toCron`, for describing a registered schedule. Null for any
 * expression the picker could not have produced — a step value, a day of the
 * month, a month, a four- or six-field spec — so the caller falls back to the
 * literal text instead of inventing a reading.
 */
export function fromCron(cron: string): TimeOfDay | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dom, month, dowField] = fields;
  if (dom !== "*" || month !== "*") return null;
  const minute = parseField(minuteField, 59);
  const hour = parseField(hourField, 23);
  const days = parseDays(dowField);
  if (minute === null || hour === null || days === null) return null;
  return { hour, minute, days };
}

/**
 * The zone this browser keeps time in, e.g. `Asia/Taipei`; empty when it
 * cannot be known (server render, or a runtime without Intl).
 *
 * Sent with every timed trigger the form registers, because a cron with no
 * zone is read by the backend in UTC, and "09:00" typed by an operator in
 * Taipei has never once meant 09:00 UTC.
 */
export function browserTimeZone(): string {
  if (typeof window === "undefined" || typeof Intl === "undefined") return "";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `Daily` / `Weekdays` / `Mon, Wed, Fri`. */
function describeDays(days: readonly number[]): string {
  if (days.length === 7) return "Daily";
  if (
    days.length === WEEKDAY_VALUES.length &&
    WEEKDAY_VALUES.every((day) => days.includes(day))
  ) {
    return "Weekdays";
  }
  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(", ");
}

/** `every 30 min` / `Weekdays at 09:00 · Asia/Taipei`. */
export function describeTrigger(trigger: ScheduleTrigger): string {
  if (trigger.cron) {
    const timed = fromCron(trigger.cron);
    const when = timed
      ? `${describeDays(timed.days)} at ${pad(timed.hour)}:${pad(timed.minute)}`
      : trigger.cron;
    return trigger.timezone ? `${when} · ${trigger.timezone}` : when;
  }
  const seconds = trigger.interval_seconds;
  if (!seconds) return "—";
  if (seconds % 3600 === 0) return `every ${seconds / 3600} h`;
  if (seconds % 60 === 0) return `every ${seconds / 60} min`;
  return `every ${seconds} s`;
}

/**
 * The registered schedules that were frozen from each template, keyed by
 * template id.
 *
 * Only schedules that carry a `task_template_id` land here — one registered
 * straight from the composer references no row and belongs to no template. That
 * is also why this is a lookup built from the schedule list rather than a field
 * on the template: the backend's template response says nothing about
 * schedules, and the provenance only exists in the Temporal memo.
 */
export function schedulesByTemplate(
  schedules: readonly ScheduleState[],
): Map<string, ScheduleState[]> {
  const byTemplate = new Map<string, ScheduleState[]>();
  for (const schedule of schedules) {
    const id = schedule.task_template_id;
    if (!id) continue;
    const existing = byTemplate.get(id);
    if (existing) existing.push(schedule);
    else byTemplate.set(id, [schedule]);
  }
  return byTemplate;
}
