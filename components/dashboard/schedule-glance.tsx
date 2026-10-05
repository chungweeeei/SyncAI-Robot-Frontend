"use client";

import Link from "next/link";
import { ArrowUpRightIcon, PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Chip, InstrumentGroup } from "@/components/console/instrument";
import { IconButton } from "@/components/tasks/icon-button";
import { useSchedules } from "@/hooks/use-schedules";
import { describeNextRun, glanceSchedules } from "@/lib/task/schedule";

/**
 * What the robot will set off to do on its own, at the top of the rail.
 *
 * A glance, not the list: a name, when it next runs, and the controls worth
 * having beside the map — holding a schedule back while someone works in front
 * of the robot, and, by request, deleting one. Editing and registering stay on
 * /tasks, where the row has the width for its steps and its trigger; this
 * group links there.
 *
 * It shares `useSchedules` and its cache entry with /tasks, which is why it
 * costs the dashboard no poll: the list is re-read just after its soonest run,
 * not on an interval (see `nextScheduleRefetchMs`).
 */
export function ScheduleGlance() {
  const { schedules, readAtMs, status, error, busy, pause, resume, remove } =
    useSchedules();
  const rows = glanceSchedules(schedules, readAtMs);

  return (
    <InstrumentGroup
      label="Schedules"
      action={
        // An icon, by request, sized like the other header actions. The words
        // move to the accessible name and the tooltip, which is what tells a
        // mouse and a screen reader where the arrow goes.
        <Link
          href="/tasks"
          aria-label="View all schedules"
          title="View all schedules"
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          <ArrowUpRightIcon className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {status === "loading" ? (
        <Line>Loading schedules…</Line>
      ) : status === "error" ? null : rows.length === 0 ? (
        <Line>No schedules are registered on this robot.</Line>
      ) : (
        // Bounded rather than cut (see glanceSchedules): about four rows, then
        // the list scrolls, so a robot with many schedules does not push
        // Posture off a short rail.
        <ul className="max-h-36 space-y-1 overflow-y-auto">
          {rows.map(({ schedule, next }) => {
            // The job it was frozen from names it, as a history row is named;
            // the id is the fallback for a schedule registered without one.
            const name = schedule.task_template_name ?? schedule.id;
            return (
              <li key={schedule.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px]" title={name}>
                  {name}
                </span>
                {schedule.paused ? (
                  <Chip tone="caution">Paused</Chip>
                ) : (
                  <span className="readout shrink-0 text-[12px] text-muted-foreground">
                    {/* The snapshot's read time, not the clock, as `now`: the
                      * row is a function of the list it came with. */}
                    {next ? describeNextRun(new Date(next), new Date(readAtMs)) : "—"}
                  </span>
                )}
                <IconButton
                  label={
                    schedule.paused
                      ? `Resume schedule ${name}`
                      : `Pause schedule ${name}`
                  }
                  disabled={busy}
                  onClick={() =>
                    void (schedule.paused ? resume(schedule.id) : pause(schedule.id))
                  }
                >
                  {schedule.paused ? (
                    <PlayIcon className="size-3.5" aria-hidden />
                  ) : (
                    <PauseIcon className="size-3.5" aria-hidden />
                  )}
                </IconButton>
                <IconButton
                  label={`Delete schedule ${name}`}
                  disabled={busy}
                  className="text-signal-warn hover:bg-signal-warn/12"
                  onClick={() => {
                    // A confirm rather than an undo, as on /tasks: a deleted
                    // schedule cannot be brought back from this console.
                    if (
                      window.confirm(
                        `Delete schedule "${name}"? This cannot be undone.`,
                      )
                    ) {
                      void remove(schedule.id);
                    }
                  }}
                >
                  <Trash2Icon className="size-3.5" aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {/* The read's failure or the last pause / resume refusal, in the
        * backend's own words. */}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-signal-warn">
          {error}
        </p>
      )}
    </InstrumentGroup>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
  );
}
