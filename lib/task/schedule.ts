// How a registered trigger is written for an operator, and how the form's timed
// trigger becomes the cron string the backend wants.
//
// Cron never reaches the screen: the form offers only a time of day and a set
// of weekdays, so this module owns both directions — the one canonical cron the
// picker produces, and the reading back of any cron inside that vocabulary. One
// outside it (a `*/15`, a day of the month) is shown verbatim rather than
// misdescribed: a wrong sentence about when a robot moves is worse than an
// opaque one.

import type { ScheduleState, ScheduleTrigger } from "@/lib/api/schedule";
import type { TaskStepRequest } from "@/lib/api/task";
import type { TemplateStep } from "@/lib/api/task-template";
import { isNavStep, toDispatchSteps, wireLinked } from "@/lib/task/step";

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

/** Short day name by cron number, for reading a Date's getDay(). */
const SHORT_BY_DAY: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The three day sets the form offers as one click; anything else is a Custom pick. */
export const DAILY_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAY_DAYS: readonly number[] = [1, 2, 3, 4, 5];
export const WEEKEND_DAYS: readonly number[] = [0, 6];

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
 * Never a range, so every trigger has exactly one spelling and two schedules
 * that fire at the same moments compare equal.
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

/** Read a day-of-week field back: `*`, a comma list, or `a-b` ranges over 0–7 (7 folds into Sunday 0). */
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
 * The inverse of `toCron`. Null for any expression the picker could not have
 * produced, so the caller shows the literal text instead of inventing a reading.
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

/** The form's Repeat picker: three one-click day sets, a free pick, an interval. */
export type ScheduleRepeat = "daily" | "weekdays" | "weekends" | "custom" | "interval";

export type IntervalUnit = "minutes" | "hours";

/** What the schedule form's fields start at. */
export interface ScheduleFormSeed {
  repeat: ScheduleRepeat;
  /** `HH:MM`, what `<input type="time">` holds. */
  time: string;
  /** Only read under "custom". */
  customDays: readonly number[];
  amountText: string;
  unit: IntervalUnit;
}

/** A new schedule's fields. Custom starts at the weekdays: a custom pick is usually "weekdays, minus one". */
export const DEFAULT_FORM_SEED: ScheduleFormSeed = {
  repeat: "daily",
  time: "09:00",
  customDays: WEEKDAY_DAYS,
  amountText: "30",
  unit: "minutes",
};

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  const left = sortedUniqueDays(a);
  const right = sortedUniqueDays(b);
  return left.length === right.length && left.every((day, index) => day === right[index]);
}

/**
 * The form's fields for editing a registered trigger.
 *
 * A preset day set opens as that preset, not as Custom. A trigger the form
 * could not have written (a foreign cron, an interval that is not whole
 * minutes) opens on the defaults: an approximation would show a rule the
 * schedule does not follow, and one Save would make it the rule.
 */
export function scheduleFormSeed(trigger: ScheduleTrigger): ScheduleFormSeed {
  if (trigger.cron) {
    const timed = fromCron(trigger.cron);
    if (!timed) return DEFAULT_FORM_SEED;
    const time = `${pad(timed.hour)}:${pad(timed.minute)}`;
    const preset: ScheduleRepeat | null = sameDays(timed.days, DAILY_DAYS)
      ? "daily"
      : sameDays(timed.days, WEEKDAY_DAYS)
        ? "weekdays"
        : sameDays(timed.days, WEEKEND_DAYS)
          ? "weekends"
          : null;
    return preset
      ? { ...DEFAULT_FORM_SEED, repeat: preset, time }
      : { ...DEFAULT_FORM_SEED, repeat: "custom", time, customDays: timed.days };
  }
  const seconds = trigger.interval_seconds;
  if (!seconds || seconds <= 0) return DEFAULT_FORM_SEED;
  if (seconds % 3600 === 0) {
    return { ...DEFAULT_FORM_SEED, repeat: "interval", amountText: String(seconds / 3600), unit: "hours" };
  }
  if (seconds % 60 === 0) {
    return { ...DEFAULT_FORM_SEED, repeat: "interval", amountText: String(seconds / 60), unit: "minutes" };
  }
  return DEFAULT_FORM_SEED;
}

/**
 * Whether two triggers fire at the same moments, so a no-op edit is not sent.
 * The zone counts: re-registering in this browser's zone is a real change
 * even when the fields read the same.
 */
export function sameTrigger(a: ScheduleTrigger, b: ScheduleTrigger): boolean {
  if (a.cron || b.cron) {
    return a.cron === b.cron && (a.timezone || null) === (b.timezone || null);
  }
  return (a.interval_seconds ?? null) === (b.interval_seconds ?? null);
}

/**
 * The zone this browser keeps time in, e.g. `Asia/Taipei`; empty when unknown
 * (server render, no Intl). Sent with every timed trigger, because the backend
 * reads a zoneless cron as UTC.
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
    days.length === WEEKDAY_DAYS.length &&
    WEEKDAY_DAYS.every((day) => days.includes(day))
  ) {
    return "Weekdays";
  }
  if (
    days.length === WEEKEND_DAYS.length &&
    WEEKEND_DAYS.every((day) => days.includes(day))
  ) {
    return "Weekends";
  }
  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.short)
    .join(", ");
}

const DAY_MS = 86_400_000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * The first moment after `now` a timed trigger fires, in this runtime's clock
 * (the zone the form sends, so they agree). Walking day by day through the Date
 * constructor rather than adding milliseconds keeps a daylight-saving change
 * from shifting "09:00". Null when no day is selected.
 */
export function nextTimedRun({ hour, minute, days }: TimeOfDay, now: Date): Date | null {
  if (!days.length) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      hour,
      minute,
    );
    if (candidate.getTime() > now.getTime() && days.includes(candidate.getDay())) {
      return candidate;
    }
  }
  return null;
}

/**
 * `today 09:00` / `tomorrow 09:00` / `Thu 09:00`. The next timed run is always
 * inside a week, so the weekday is never ambiguous.
 */
export function describeNextRun(next: Date, now: Date): string {
  const time = `${pad(next.getHours())}:${pad(next.getMinutes())}`;
  const dayDiff = Math.round((startOfDay(next) - startOfDay(now)) / DAY_MS);
  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `tomorrow ${time}`;
  return `${SHORT_BY_DAY[next.getDay()]} ${time}`;
}

/**
 * `2026-08-04 09:00` in this runtime's local clock — the zone the form
 * registered the trigger in, so the list answers in the numbers it was given.
 */
export function formatLocalRunTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * `2026-08-04 09:00` sliced out of the ISO string (UTC, no clock): the server
 * render's answer, since a local format there would not match the hydrated
 * string. Same rule as formatTimestamp in lib/recording/format.ts.
 */
export function formatUtcRunTime(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * The run a row should call "next": the first of `next_run_times` still ahead
 * of `readAtMs`, or undefined when there is none or the schedule is paused.
 *
 * The list is a snapshot, so its head can be a time that has already fired;
 * `nextScheduleRefetchMs` re-reads just after, but the describe can still
 * report the run it just started. Stepping over the past keeps the readout
 * true either side of that read. Measured against the read time so a row is a
 * pure function of its snapshot.
 *
 * A paused schedule still reports future times that will not happen, so it
 * has no next run.
 */
export function upcomingRun(
  schedule: ScheduleState,
  readAtMs: number,
): string | undefined {
  if (schedule.paused) return undefined;
  return schedule.next_run_times.find((iso) => Date.parse(iso) > readAtMs);
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
 * How long after a schedule's fire time the list is re-read: slack for the two
 * clocks disagreeing, since `next_run_times` is recomputed the moment it fires.
 */
export const RUN_REFETCH_SLACK_MS = 2000;

/**
 * The retry when the soonest run is already past and the list still says so
 * (a missed slot, or a browser clock ahead). Re-reading at once would loop.
 */
export const OVERDUE_REFETCH_MS = 30_000;

/** The longest a refetch is deferred: a timer past 2^31 - 1 ms overflows and fires at once. */
export const MAX_REFETCH_MS = 86_400_000;

/**
 * When to re-read the schedule list next, in ms, or false for never: just
 * after the soonest `next_run_times[0]` across unpaused rows (see CLAUDE.md,
 * "A knowable moment beats a poll"). An unparseable date is skipped so it
 * cannot become a bad timer.
 *
 * Measured from `readAtMs`, never `Date.now()`: TanStack restarts the timer
 * whenever the interval changes, and the page re-renders on another poll.
 */
export function nextScheduleRefetchMs(
  schedules: readonly ScheduleState[],
  readAtMs: number,
): number | false {
  let soonest = Number.POSITIVE_INFINITY;
  for (const schedule of schedules) {
    if (schedule.paused) continue;
    const next = schedule.next_run_times[0];
    if (!next) continue;
    const at = new Date(next).getTime();
    if (!Number.isNaN(at) && at < soonest) soonest = at;
  }
  if (soonest === Number.POSITIVE_INFINITY) return false;
  const untilRun = soonest - readAtMs;
  if (untilRun <= 0) return OVERDUE_REFETCH_MS;
  return Math.min(untilRun + RUN_REFETCH_SLACK_MS, MAX_REFETCH_MS);
}

/**
 * The schedules frozen from each template, by template id. Built from the
 * schedule list because the template response says nothing about schedules;
 * one registered straight from the composer has no `task_template_id`.
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

/**
 * How many frozen steps the template would now dispatch differently — the
 * schedule row's "stale" badge — or null when they are not comparable (a
 * changed step count, or a template step with no coordinates).
 *
 * - A MOVE compares at the precision dispatched (3 decimals x/y, 1 heading),
 *   so float noise is not drift.
 * - A SPEAK drifts on its line or count, a WAIT on its duration, any step on
 *   its type.
 * - A step linked to (or unlinked from) the one above drifts. Compared as
 *   links, not group names, so a renamed group is the same job.
 */
export function scheduleDrift(
  frozen: readonly TaskStepRequest[],
  template: readonly TemplateStep[],
): number | null {
  let current: TaskStepRequest[];
  try {
    current = toDispatchSteps(template);
  } catch {
    return null;
  }
  if (current.length !== frozen.length) return null;

  return frozen.reduce((count, step, index) => {
    const now = current[index];
    if (!now || now.type !== step.type) return count + 1;
    if (wireLinked(frozen, index) !== wireLinked(current, index)) return count + 1;
    if (step.type === "SPEAK" && now.type === "SPEAK") {
      // A missing count is once: a schedule frozen before the field has none.
      const same =
        step.params.text === now.params.text &&
        (step.params.repeat ?? 1) === (now.params.repeat ?? 1);
      return same ? count : count + 1;
    }
    if (step.type === "WAIT" && now.type === "WAIT") {
      return step.params.seconds === now.params.seconds ? count : count + 1;
    }
    if (step.type === "DEMO" && now.type === "DEMO") {
      return step.params.inspection === now.params.inspection ? count : count + 1;
    }
    if (!isNavStep(step) || !isNavStep(now)) return count;
    const same =
      step.params.x.toFixed(3) === now.params.x.toFixed(3) &&
      step.params.y.toFixed(3) === now.params.y.toFixed(3) &&
      step.params.theta.toFixed(1) === now.params.theta.toFixed(1);
    return same ? count : count + 1;
  }, 0);
}

/**
 * The schedules the dashboard lists, soonest next run first and those with
 * none (paused, or past the snapshot) last. Ties keep the backend's order so
 * rows do not swap between reads that agree.
 *
 * Not truncated: a row just paused sorts last, and a cut would hide the
 * Resume that undoes the press.
 */
export function glanceSchedules(
  schedules: readonly ScheduleState[],
  readAtMs: number,
): { schedule: ScheduleState; next: string | undefined }[] {
  return schedules
    .map((schedule) => ({ schedule, next: upcomingRun(schedule, readAtMs) }))
    .sort((a, b) => compareRuns(runOrder(a.next), runOrder(b.next)));
}

// Not a bare subtraction: two rows with no next run are Infinity - Infinity,
// which is NaN, and a comparator that answers NaN leaves the order undefined.
function compareRuns(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function runOrder(next: string | undefined): number {
  const at = next === undefined ? NaN : Date.parse(next);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}
