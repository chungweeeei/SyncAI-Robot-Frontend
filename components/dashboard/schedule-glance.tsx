"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  EllipsisIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { InstrumentGroup } from "@/components/console/instrument";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveTasksSelect } from "@/hooks/use-console-active-tasks";
import { useSchedules } from "@/hooks/use-schedules";
import type { ScheduleState } from "@/lib/api/schedule";
import {
  describeNextRun,
  describeTrigger,
  glanceSchedules,
  runningScheduleIds,
} from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/**
 * What the robot will do on its own, at the top of the rail: name, next run,
 * cadence, and Pause / Delete (by request). Editing stays on /tasks.
 *
 * Pause / Resume sits on the row (by request): it is the action the rail is
 * for, and it undoes itself. Delete stays behind the row's ⋯, since a Delete
 * beside Pause is one a finger hits by mistake.
 *
 * The soonest run is drawn apart, as a card in the commanded hue with its time
 * as the large figure (by request: the group read as one more grey list beside
 * Locomotion and Motors, when it is the one that changes the next ten minutes
 * on its own). The rest stay rows. A schedule with a run going says so in the
 * active hue, the colour a run has on the masthead.
 *
 * Shares `useSchedules` with /tasks, so it costs no poll: the list is re-read
 * just after its soonest run (see `nextScheduleRefetchMs`). Which schedules
 * are running is a selector on the console's active-tasks poll, no request of
 * its own.
 */
export function ScheduleGlance() {
  const {
    schedules,
    readAtMs,
    status,
    error,
    busy,
    pause,
    resume,
    remove,
    clearError,
  } = useSchedules();
  const rows = glanceSchedules(schedules, readAtMs);
  const { data: running = NONE_RUNNING } = useActiveTasksSelect(runningScheduleIds);
  // Sorted soonest first; a list of paused rows has no next run, and no card.
  const lead = rows[0]?.next !== undefined ? rows[0] : null;
  const rest = lead ? rows.slice(1) : rows;
  const live = rows.filter(({ schedule }) => !schedule.paused).length;
  /** The schedule the delete dialog is asking about; null while it is closed. */
  const [deleting, setDeleting] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  const askDelete = (id: string) => (name: string) => {
    clearError();
    setDeleting({ id, name });
  };

  const closeDelete = () => {
    setDeleting(null);
    clearError();
  };

  return (
    <InstrumentGroup
      label="Schedules"
      icon={<CalendarClockIcon className="size-3.5 text-signal-cmd" aria-hidden />}
      action={
        <span className="flex items-center gap-1.5">
          {/* How many will fire, then how many are held: a count of all
            * would promise runs a paused one will not make. */}
          {rows.length > 0 && (
            <span className="readout text-[11px] text-muted-foreground">
              {live} active
              {rows.length > live && ` · ${rows.length - live} paused`}
            </span>
          )}
          {/* An icon, by request; the words are on the name and tooltip. */}
            <Link
            href="/tasks"
            aria-label="View all schedules"
            title="View all schedules"
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
            <ArrowUpRightIcon className="size-3.5" aria-hidden />
          </Link>
        </span>
      }
    >
      {status === "loading" ? (
        <Line>Loading schedules…</Line>
      ) : status === "error" ? null : rows.length === 0 ? (
        <EmptySchedules />
      ) : (
        <>
          {lead && (
            // A list of one so it reads in order with the rows under it.
            <ul>
              <ScheduleGlanceRow
                lead
                schedule={lead.schedule}
                next={lead.next}
                readAtMs={readAtMs}
                running={running.includes(lead.schedule.id)}
                busy={busy}
                onPause={() => void pause(lead.schedule.id)}
                onResume={() => void resume(lead.schedule.id)}
                onDelete={askDelete(lead.schedule.id)}
              />
            </ul>
          )}
          {rest.length > 0 && (
            // Four and a half rows, then it scrolls; the half row is the
            // scroll cue (a sliver read as a rendering fault).
            <ul className="-mx-1 max-h-48 space-y-0.5 overflow-y-auto">
              {rest.map(({ schedule, next }) => (
                <ScheduleGlanceRow
                  key={schedule.id}
                  schedule={schedule}
                  next={next}
                  readAtMs={readAtMs}
                  running={running.includes(schedule.id)}
                  busy={busy}
                  onPause={() => void pause(schedule.id)}
                  onResume={() => void resume(schedule.id)}
                  onDelete={askDelete(schedule.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* A delete's refusal is the dialog's to show. */}
      {error && !deleting && (
        <ErrorLine>
          {error}
        </ErrorLine>
      )}

      {/* A refusal keeps it open with the backend's sentence. */}
      <ConfirmDialog
        open={deleting !== null}
        title={<>Delete {deleting?.name}?</>}
        busy={busy}
        error={deleting ? error : null}
        onConfirm={() => {
          if (!deleting) return;
          void remove(deleting.id).then((gone) => {
            if (gone) setDeleting(null);
          });
        }}
        onClose={closeDelete}
      >
        The robot will stop running it on its own. This cannot be undone — it
        would have to be scheduled again from Tasks.
      </ConfirmDialog>
    </InstrumentGroup>
  );
}

/**
 * One schedule. A row is two lines, so the name has the rail's width to
 * itself; the `lead` one is the card, its next run the large figure.
 */
function ScheduleGlanceRow({
  schedule,
  next,
  readAtMs,
  lead = false,
  running,
  busy,
  onPause,
  onResume,
  onDelete,
}: {
  schedule: ScheduleState;
  next: string | undefined;
  readAtMs: number;
  lead?: boolean;
  running: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: (name: string) => void;
}) {
  const name = schedule.task_template_name ?? schedule.id;
  // Measured from the snapshot's read time, and absolute rather than a
  // countdown, which would need its own clock between re-reads.
  const when = schedule.paused
    ? "paused"
    : next
      ? describeNextRun(new Date(next), new Date(readAtMs))
      : "—";
  const actions = (
    <RowActions
      name={name}
      paused={schedule.paused}
      busy={busy}
      onPause={onPause}
      onResume={onResume}
      onDelete={onDelete}
    />
  );

  if (lead) {
    return (
      <li className="flex items-start gap-1 rounded-sm border border-signal-cmd/40 bg-signal-cmd/8 py-2 pr-1 pl-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between gap-2">
            {/* Said to a screen reader with the name, below. */}
            <span aria-hidden className="instrument-label text-signal-cmd">
              Up next
            </span>
            {running && <RunningNow />}
          </p>
          <p className="readout mt-1.5 text-[18px] leading-none font-semibold text-signal-cmd">
            {when}
          </p>
          <p className="mt-1.5 truncate text-[14px] leading-tight font-semibold" title={name}>
            <span className="sr-only">Up next: </span>
            {name}
          </p>
          <p className="readout mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
            {describeTrigger(schedule.trigger)}
          </p>
        </div>
        {actions}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-1 py-1 pr-0.5 pl-1">
      {/* Dimmed, not badged: a chip made the least urgent row the loudest. */}
      <div className={cn("min-w-0 flex-1", schedule.paused && "opacity-55")}>
        <p className="flex items-center gap-1 text-[13px] leading-tight">
          {schedule.paused && (
            <PauseIcon className="size-3 shrink-0" aria-hidden />
          )}
          <span className="truncate" title={name}>
            {name}
          </span>
        </p>
        <p className="readout mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
          {running ? <RunningNow /> : <span className="shrink-0">{when}</span>}
          <span className="truncate">· {describeTrigger(schedule.trigger)}</span>
        </p>
      </div>
      {actions}
    </li>
  );
}

/** A run of this schedule is going now, in the hue the masthead gives a run. */
function RunningNow() {
  return (
    <span className="instrument-label flex shrink-0 items-center gap-1 text-signal-active">
      <span className="size-1.5 rounded-full bg-signal-active" aria-hidden />
      Running now
    </span>
  );
}

/** Pause / Resume, then the ⋯ that holds Delete. */
function RowActions({
  name,
  paused,
  busy,
  onPause,
  onResume,
  onDelete,
}: {
  name: string;
  paused: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: (name: string) => void;
}) {
  return (
    <>
      {/* Named for the schedule: a list of bare "Pause" buttons tells a
        * screen reader nothing about which row it is on. */}
      <button
        type="button"
        aria-label={`${paused ? "Resume" : "Pause"} schedule ${name}`}
        title={paused ? "Resume" : "Pause"}
        disabled={busy}
        onClick={paused ? onResume : onPause}
        className={ROW_BUTTON}
      >
        {paused ? (
          <PlayIcon className="size-3.5" aria-hidden />
        ) : (
          <PauseIcon className="size-3.5" aria-hidden />
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for schedule ${name}`}
          title="More actions"
          disabled={busy}
          className={ROW_BUTTON}
        >
          <EllipsisIcon className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        {/* Styled like the rail's panels here, not in components/ui, so the
          * task editor's menu keeps its look. */}
        <DropdownMenuContent
          align="end"
          sideOffset={2}
          className="w-44 rounded-sm border border-hairline bg-panel p-1 shadow-md ring-0"
        >
          {/* Names the schedule: on a phone the finger hides the row. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="instrument-label truncate px-2 pt-1 pb-1.5 text-muted-foreground">
              {name}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="my-1 bg-hairline" />
          <DropdownMenuItem
            onClick={() => onDelete(name)}
            className={cn(
              MENU_ITEM,
              "text-signal-warn focus:bg-signal-warn/12 focus:text-signal-warn focus:**:text-signal-warn",
            )}
          >
            <Trash2Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Nothing registered: say so, and where one is made. */
function EmptySchedules() {
  return (
    <div className="flex items-start gap-2 rounded-sm border border-dashed border-hairline px-2.5 py-2">
      <CalendarClockIcon className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 text-[11px] leading-snug text-muted-foreground">
        <p>No schedules are registered on this robot.</p>
        <Link
          href="/tasks"
          className="mt-1 inline-block font-medium text-signal-cmd underline-offset-2 hover:underline"
        >
          Schedule a task →
        </Link>
      </div>
    </div>
  );
}

/** The row's two icon buttons, Pause / Resume and ⋯, at the rail's scale. */
const ROW_BUTTON =
  "flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10";

/** One menu row at the rail's scale: 28 px tall, 12 px type, 14 px icon. */
/** Nothing running: a constant, so the empty answer is one array, not a new one each render. */
const NONE_RUNNING: string[] = [];

const MENU_ITEM =
  "h-7 gap-2 rounded-sm px-2 py-0 text-[12px] focus:bg-elevated focus:text-foreground pointer-coarse:h-10 pointer-coarse:py-0 [&_svg:not([class*='size-'])]:size-3.5";

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
  );
}
