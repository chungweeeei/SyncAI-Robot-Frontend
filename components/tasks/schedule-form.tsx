"use client";

import * as React from "react";
import { CalendarPlusIcon } from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import type { ScheduleTrigger } from "@/lib/api/schedule";
import {
  DAILY_DAYS,
  WEEKDAYS,
  WEEKDAY_DAYS,
  WEEKEND_DAYS,
  describeNextRun,
  describeTrigger,
  nextTimedRun,
  toCron,
} from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/** The presets: three one-click day sets, a free pick, and a plain interval. */
type Repeat = "daily" | "weekdays" | "weekends" | "custom" | "interval";

const REPEAT_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekends", label: "Weekends" },
  { value: "custom", label: "Custom" },
  { value: "interval", label: "Interval" },
] as const satisfies readonly { value: Repeat; label: string }[];

type IntervalUnit = "minutes" | "hours";

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
  onCreate: (id: string, trigger: ScheduleTrigger) => void;
}

/**
 * Register the authored step list to run on a timer.
 *
 * One "Repeat" picker instead of a kind switch followed by a value: Daily,
 * Weekdays and Weekends are the patrols every site asks for and each is one
 * click, Custom opens the seven day toggles, Interval opens a count and a unit.
 * Only the selected kind is ever built into the request, which is what makes
 * the backend's cron-XOR-interval validator unreachable: "provide exactly one"
 * cannot fail.
 *
 * Nothing here is cron. The backend's timed trigger is a cron string and the
 * field used to be that string, with `0 9 * * 1-5` as its placeholder — the one
 * control on this screen an end customer could not fill in without asking an
 * engineer. The form builds it with `toCron` and is the only writer, so what
 * this console registers always reads back as a sentence in the list. The
 * interval is entered in minutes or hours for the same reason: nobody thinks in
 * 1800 seconds.
 *
 * The preview line under the fields is the same `describeTrigger` the schedule
 * list renders with, so the words an operator reads before pressing Create are
 * the words that will appear in the list — one vocabulary, no translation
 * between the two. A timed trigger also shows its next run, which is the only
 * way to answer "which 09:00" before the request goes out.
 *
 * The timezone is this browser's, sent unasked and named in the preview rather
 * than offered as a field. A cron without one is read by the backend in UTC,
 * and an operator typing 09:00 means 09:00 where they are standing; the robot is
 * on the same LAN, so that zone is the right one in every case we have met.
 * Until the browser has reported it the local-time sentence is held back, which
 * is what keeps the server render and the first client render identical.
 *
 * The id is operator-authored with no prefill, unlike a task id. A schedule is a
 * durable named thing they have to recognise in the list a week later, and
 * `robot01-sched-1782786519` is not that.
 *
 * Reset is by remounting — TaskConsole keys this component and bumps the key
 * after a successful create — rather than by clearing six fields in an effect.
 */
export function ScheduleForm({
  existingIds,
  ready,
  reason,
  busy,
  error,
  onCreate,
}: ScheduleFormProps) {
  const [id, setId] = React.useState("");
  const [repeat, setRepeat] = React.useState<Repeat>("daily");
  const [time, setTime] = React.useState("09:00");
  // Only read while `repeat` is "custom"; seeded with the weekdays because a
  // custom pick is almost always "weekdays, minus one" rather than a build-up
  // from nothing.
  const [customDays, setCustomDays] = React.useState<readonly number[]>(WEEKDAY_DAYS);
  const [amountText, setAmountText] = React.useState("30");
  const [unit, setUnit] = React.useState<IntervalUnit>("minutes");
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

  // `id: str` has no min_length on the backend, so a blank one would reach
  // Temporal and come back as a 502 rather than a sentence about the name.
  const duplicate = trimmedId.length > 0 && existingIds.includes(trimmedId);

  const localReason = !trimmedId
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

  const submittable = ready && !busy && !localReason;

  /**
   * What will be sent, built once so the preview and the request cannot drift.
   * Null while the fields do not yet make a trigger. The zone is omitted rather
   * than sent blank when the browser could not name one, and never sent for an
   * interval: the backend applies it only to the cron path, and a request
   * carrying a field with no effect is a lie in the log.
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

  // The preview is only shown once the browser has a zone: it is built from the
  // browser's clock, so a server-rendered version would name a different
  // moment than the one the operator sees after hydration. Both lines gate on
  // the same value for that reason.
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
        onCreate(trimmedId, trigger);
      }}
    >
      <label className="block">
        <span className="instrument-label text-muted-foreground">Schedule name</span>
        <Input
          value={id}
          disabled={busy}
          onChange={(event) => setId(event.target.value)}
          placeholder="robot01-daily-patrol"
          className="readout mt-0.5 h-7 rounded-sm text-[13px]"
        />
      </label>

      <div>
        <span className="instrument-label text-muted-foreground">Repeat</span>
        <Segmented
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
              className="readout h-7 w-16 rounded-sm text-[13px]"
            />
          </label>
          <Segmented
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
            className="readout h-7 w-32 rounded-sm text-[13px]"
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
        className="instrument-label flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <CalendarPlusIcon className="size-3.5" aria-hidden />
        Create schedule
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
 * Seven pressed/unpressed days, drawn as one strip in Segmented's clothes so
 * the row reads as the same instrument as the Repeat picker above it.
 * Segmented itself is not reused because it is single-select — a set of days is
 * the one control on the console where several segments can be lit at once.
 * Each button is a real button with `aria-pressed`, so the state is announced
 * and the keyboard reaches every day without a custom handler.
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
              "instrument-label h-6 min-w-0 flex-1 truncate px-1 transition-colors",
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
