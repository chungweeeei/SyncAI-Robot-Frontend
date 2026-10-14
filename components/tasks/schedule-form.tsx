"use client";

import * as React from "react";
import { CalendarCheckIcon, CalendarPlusIcon } from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import type { ScheduleTrigger } from "@/lib/api/schedule";
import {
  DAILY_DAYS,
  DEFAULT_FORM_SEED,
  WEEKDAYS,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  describeNextRun,
  describeTrigger,
  nextTimedRun,
  sameTrigger,
  scheduleFormSeed,
  toCron,
  type IntervalUnit,
  type ScheduleRepeat,
} from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

const REPEAT_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom" },
  { value: "interval", label: "Interval" },
] as const satisfies readonly { value: ScheduleRepeat; label: string }[];

const UNIT_OPTIONS = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
] as const satisfies readonly { value: IntervalUnit; label: string }[];

const SECONDS_PER: Record<IntervalUnit, number> = { minutes: 60, hours: 3600 };

/** What `<input type="time">` yields: `HH:MM`, or `""` when cleared. */
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export interface ScheduleFormProps {
  /** Already-registered ids, so a duplicate is refused before the 400. */
  existingIds: readonly string[];
  /** False when the step list itself is not sendable. */
  ready: boolean;
  /** Why not, as a muted line under the button. Null when ready. */
  reason: string | null;
  busy: boolean;
  error: string | null;
  /** The schedule being edited; its trigger seeds the fields. No name field: a schedule cannot be renamed. */
  editing?: { id: string; trigger: ScheduleTrigger };
  onSubmit: (id: string, trigger: ScheduleTrigger) => void;
}

/**
 * Register the authored step list to run on a timer.
 *
 * One Repeat picker (Daily, Weekdays, Weekends, Custom days, Interval), and
 * only the selected kind is built into the request, so the backend's
 * cron-XOR-interval check cannot fail. No cron is typed: `toCron` builds it,
 * so what this console registers reads back as a sentence, and an interval is
 * in minutes or hours.
 *
 * The preview uses the list's `describeTrigger`, so it says what the list will
 * say, plus the next run to answer "which 09:00". The timezone is the
 * browser's, sent unasked (a bare cron is read in UTC); the preview waits for
 * it so the server and first client render match.
 *
 * The name is the operator's, unprefilled: it has to be recognisable a week
 * later. Reset and edit are by remount, with fields seeded once.
 */
export function ScheduleForm({
  existingIds,
  ready,
  reason,
  busy,
  error,
  editing,
  onSubmit,
}: ScheduleFormProps) {
  // Read once: following the prop would overwrite a half-made change on re-read.
  const [seed] = React.useState(() =>
    editing ? scheduleFormSeed(editing.trigger) : DEFAULT_FORM_SEED,
  );
  const [id, setId] = React.useState(editing?.id ?? "");
  const [repeat, setRepeat] = React.useState<ScheduleRepeat>(seed.repeat);
  const [time, setTime] = React.useState(seed.time);
  // Only read while `repeat` is "custom".
  const [customDays, setCustomDays] = React.useState<readonly number[]>(seed.customDays);
  const [amountText, setAmountText] = React.useState(seed.amountText);
  const [unit, setUnit] = React.useState<IntervalUnit>(seed.unit);
  const timezone = useBrowserTimeZone();

  const trimmedId = id.trim();

  const days =
    repeat === "daily"
      ? DAILY_DAYS
      : repeat === "weekdays"
        ? WEEKDAY_DAYS
        : repeat === "weekends"
          ? WEEKEND_DAYS
          : customDays;
  const timeMatch = TIME_PATTERN.exec(time);
  const timed = timeMatch
    ? { hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), days }
    : null;

  const amount = Number(amountText.trim());
  const intervalSeconds =
    Number.isInteger(amount) && amount > 0 ? amount * SECONDS_PER[unit] : null;

  // The backend has no min_length on the id: a blank one comes back as a 502,
  // not a sentence, so it is refused here.
  const duplicate =
    !editing && trimmedId.length > 0 && existingIds.includes(trimmedId);

  const fieldsReason = !trimmedId
    ? "Name the schedule."
    : duplicate
      ? "A schedule with this name already exists."
      : repeat === "interval"
        ? intervalSeconds === null
          ? "The interval must be a whole number above zero."
          : null
        : !timed
          ? "Pick a time."
          : !days.length
            ? "Pick at least one day."
            : null;

  /**
   * Built once so the preview and the request cannot drift. The zone is
   * omitted when unknown, and for an interval, where the backend ignores it.
   */
  const trigger: ScheduleTrigger | null =
    repeat === "interval"
      ? intervalSeconds === null
        ? null
        : { interval_seconds: intervalSeconds }
      : timed && days.length
        ? timezone
          ? { cron: toCron(timed), timezone }
          : { cron: toCron(timed) }
        : null;

  const unchanged = !!editing && !!trigger && sameTrigger(trigger, editing.trigger);
  const localReason =
    fieldsReason ?? (unchanged ? "Change the time or how often it repeats." : null);
  const submittable = ready && !busy && !localReason;

  // Gated on the zone: built from the browser's clock, a server render would
  // name a different moment than the hydrated one.
  const preview = (() => {
    if (!trigger || !timezone) return null;
    if (trigger.interval_seconds) {
      return `Runs ${describeTrigger({ interval_seconds: trigger.interval_seconds })}.`;
    }
    const when = describeTrigger({ cron: trigger.cron });
    const next = timed ? nextTimedRun(timed, new Date()) : null;
    return `Runs ${when} in your local time (${timezone}).${
      next ? ` Next run ${describeNextRun(next, new Date())}.` : ""
    }`;
  })();

  const toggleDay = (day: number) =>
    setCustomDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day],
    );

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!submittable || !trigger) return;
        onSubmit(trimmedId, trigger);
      }}
    >
      {!editing && (
        <label className="block">
          <span className="instrument-label text-muted-foreground">Schedule name</span>
          <Input
            value={id}
            disabled={busy}
            onChange={(event) => setId(event.target.value)}
            placeholder="robot01-daily-patrol"
            className="readout mt-0.5 h-7 rounded-sm md:text-[13px]"
          />
        </label>
      )}

      <div>
        <span className="instrument-label text-muted-foreground">Repeat</span>
        <Segmented
          label="Repeat"
          stretch
          className="mt-0.5"
          value={repeat}
          options={REPEAT_OPTIONS}
          disabled={busy}
          onChange={setRepeat}
        />
      </div>

      {repeat === "custom" && (
        <div>
          <span className="instrument-label text-muted-foreground">Days</span>
          <DayToggles
            className="mt-0.5"
            days={customDays}
            disabled={busy}
            onToggle={toggleDay}
          />
        </div>
      )}

      {repeat === "interval" ? (
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <span className="instrument-label text-muted-foreground">Every</span>
            <Input
              inputMode="numeric"
              value={amountText}
              disabled={busy}
              onChange={(event) => setAmountText(event.target.value)}
              className="readout h-7 w-16 rounded-sm md:text-[13px]"
            />
          </label>
          <Segmented
            label="Interval unit"
            value={unit}
            options={UNIT_OPTIONS}
            disabled={busy}
            onChange={setUnit}
          />
        </div>
      ) : (
        <label className="flex items-center gap-1.5">
          <span className="instrument-label text-muted-foreground">Time</span>
          <Input
            type="time"
            step={60}
            value={time}
            disabled={busy}
            onChange={(event) => setTime(event.target.value)}
            className="readout h-7 w-32 rounded-sm md:text-[13px]"
          />
        </label>
      )}

      {preview && (
        <p className="text-[11px] leading-snug text-muted-foreground">{preview}</p>
      )}

      {error && (
        <p
          role="alert"
          className="text-[11px] leading-snug break-words text-signal-warn"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!submittable}
        className="instrument-label flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary pointer-coarse:min-h-10 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {editing ? (
          <>
            <CalendarCheckIcon className="size-3.5" aria-hidden />
            Save schedule
          </>
        ) : (
          <>
            <CalendarPlusIcon className="size-3.5" aria-hidden />
            Create schedule
          </>
        )}
      </button>

      {(localReason ?? reason) && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {localReason ?? reason}
        </p>
      )}
    </form>
  );
}

/**
 * Seven toggles styled like Segmented, which is not reused because it is
 * single-select. Real buttons with `aria-pressed`, so state is announced and
 * the keyboard reaches every day.
 */
function DayToggles({
  days,
  disabled,
  onToggle,
  className,
}: {
  days: readonly number[];
  disabled: boolean;
  onToggle: (day: number) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Days of the week"
      className={cn(
        "flex w-full overflow-hidden rounded-sm border border-hairline",
        disabled && "opacity-40",
        className,
      )}
    >
      {WEEKDAYS.map((day) => {
        const active = days.includes(day.value);
        return (
          <button
            key={day.value}
            type="button"
            aria-pressed={active}
            aria-label={day.long}
            disabled={disabled}
            onClick={() => onToggle(day.value)}
            className={cn(
              "instrument-label h-6 min-w-0 flex-1 truncate px-1 transition-colors pointer-coarse:min-h-10",
              "border-l border-hairline first:border-l-0",
              disabled && "hover:bg-transparent hover:text-muted-foreground",
              active
                ? "bg-signal-cmd/12 text-signal-cmd"
                : "text-muted-foreground hover:bg-elevated hover:text-foreground",
            )}
          >
            {day.short}
          </button>
        );
      })}
    </div>
  );
}
