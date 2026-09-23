"use client";

import * as React from "react";
import { CalendarPlusIcon } from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import type { ScheduleTrigger } from "@/lib/api/schedule";
import { WEEKDAYS, browserTimeZone, toCron } from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

type TriggerKind = "interval" | "cron";

const TRIGGER_OPTIONS = [
  { value: "interval", label: "Every" },
  { value: "cron", label: "At a time" },
] as const satisfies readonly { value: TriggerKind; label: string }[];

const ALL_DAYS = WEEKDAYS.map((day) => day.value);

/** What `<input type="time">` yields: `HH:MM`, or `""` when cleared. */
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** A useSyncExternalStore subscription for a value that cannot change. */
const neverChanges = () => () => {};

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
 * The trigger is a Segmented rather than two always-visible fields, which is what
 * makes the backend's cron-XOR-interval validator unreachable: only the selected
 * kind is ever built into the request, so "provide exactly one" cannot fail.
 *
 * "At a time" is a clock time and seven day toggles, not the cron string the
 * backend stores. The field used to be that string, with `0 9 * * 1-5` as its
 * placeholder, and it was the one control on this screen an end customer could
 * not fill in without asking an engineer — exactly the vocabulary the UI copy
 * rule keeps off the screen. The form builds the cron itself (`toCron`), and it
 * is the only writer, so what this console registers always reads back as a
 * sentence in the schedule list.
 *
 * The timezone is this browser's, sent unasked and shown as a muted line rather
 * than offered as a field. A cron without one is read by the backend in UTC, and
 * an operator typing 09:00 means 09:00 where they are standing; the robot is on
 * the same LAN, so that zone is the right one in every case we have met. It is
 * read through useSyncExternalStore with a server snapshot of "", so the server
 * render and the first client render agree — the pane is not prerendered today,
 * but the console does not rely on that.
 *
 * The id is operator-authored with no prefill, unlike a task id. A schedule is a
 * durable named thing they have to recognise in the list a week later, and
 * `robot01-sched-1782786519` is not that.
 *
 * Reset is by remounting — TaskConsole keys this component and bumps the key
 * after a successful create — rather than by clearing five fields in an effect.
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
  const [kind, setKind] = React.useState<TriggerKind>("interval");
  const [intervalText, setIntervalText] = React.useState("1800");
  const [time, setTime] = React.useState("09:00");
  const [days, setDays] = React.useState<readonly number[]>(ALL_DAYS);
  const timeId = React.useId();

  // A browser fact read once the browser exists, not state: it never changes
  // after mount, so there is nothing to synchronise. The server's answer is ""
  // and the line that shows the zone stays off until the client has one, which
  // is what keeps the server and first client render identical.
  const timezone = React.useSyncExternalStore(
    neverChanges,
    browserTimeZone,
    () => "",
  );

  const trimmedId = id.trim();
  const interval = Number(intervalText.trim());
  const timeMatch = TIME_PATTERN.exec(time);
  const timed = timeMatch
    ? { hour: Number(timeMatch[1]), minute: Number(timeMatch[2]), days }
    : null;

  // `id: str` has no min_length on the backend, so a blank one would reach
  // Temporal and come back as a 502 rather than a sentence about the name.
  const duplicate = trimmedId.length > 0 && existingIds.includes(trimmedId);

  const localReason = !trimmedId
    ? "Name the schedule."
    : duplicate
      ? "A schedule with this name already exists."
      : kind === "cron"
        ? !timed
          ? "Pick a time."
          : !days.length
            ? "Pick at least one day."
            : null
        : !(Number.isInteger(interval) && interval > 0)
          ? "The interval must be a whole number of seconds above zero."
          : null;

  const submittable = ready && !busy && !localReason;

  const toggleDay = (day: number) =>
    setDays((current) =>
      current.includes(day)
        ? current.filter((entry) => entry !== day)
        : [...current, day],
    );

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!submittable) return;
        if (kind === "interval") {
          onCreate(trimmedId, { interval_seconds: interval });
          return;
        }
        // `submittable` already required a parsed time; the guard is for the
        // type, not for a reachable state.
        if (!timed) return;
        const cron = toCron(timed);
        // The zone is omitted rather than sent blank when the browser could not
        // name one, and never sent for an interval: the backend applies it only
        // to the cron path, and a request carrying a field with no effect is a
        // lie in the log.
        onCreate(trimmedId, timezone ? { cron, timezone } : { cron });
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
        <span className="instrument-label text-muted-foreground">Trigger</span>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Segmented
            value={kind}
            options={TRIGGER_OPTIONS}
            disabled={busy}
            onChange={setKind}
          />
          {kind === "interval" ? (
            <>
              <Input
                inputMode="numeric"
                value={intervalText}
                disabled={busy}
                onChange={(event) => setIntervalText(event.target.value)}
                className="readout h-7 w-20 rounded-sm text-[13px]"
              />
              <span className="instrument-label text-muted-foreground">seconds</span>
            </>
          ) : (
            <>
              <label htmlFor={timeId} className="sr-only">
                Time of day
              </label>
              <Input
                id={timeId}
                type="time"
                step={60}
                value={time}
                disabled={busy}
                onChange={(event) => setTime(event.target.value)}
                className="readout h-7 flex-1 rounded-sm text-[13px]"
              />
            </>
          )}
        </div>
      </div>

      {kind === "cron" && (
        <div>
          <span className="instrument-label text-muted-foreground">Days</span>
          <DayToggles
            className="mt-0.5"
            days={days}
            disabled={busy}
            onToggle={toggleDay}
          />
          {/* Said in the operator's terms — the zone name is the one piece of
            * this they can check against their own clock — and only once the
            * browser has reported one; a line about a zone with no zone in it
            * would be noise. */}
          {timezone && (
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
              Runs at this time in {timezone}, this browser&apos;s timezone.
            </p>
          )}
        </div>
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
 * the row reads as the same instrument as the trigger picker beside it.
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
