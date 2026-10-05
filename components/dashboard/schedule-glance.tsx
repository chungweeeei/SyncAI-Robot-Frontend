"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  EllipsisIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { InstrumentGroup } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSchedules } from "@/hooks/use-schedules";
import type { ScheduleState } from "@/lib/api/schedule";
import {
  describeNextRun,
  describeTrigger,
  glanceSchedules,
} from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/**
 * What the robot will set off to do on its own, at the top of the rail.
 *
 * A glance, not the list: a name, when it next runs and how often, and the
 * controls worth having beside the map — holding a schedule back while someone
 * works in front of the robot, and, by request, deleting one. Editing and
 * registering stay on /tasks, where the row has the width for its steps; this
 * group links there.
 *
 * The rows are read far more often than they are acted on, so the actions sit
 * behind one ⋯ per row rather than as a pair of icons on every line: five rows
 * used to carry ten buttons, five of them red, on a group that is mostly
 * looked at, and a delete a finger could hit while reaching for Pause.
 *
 * It shares `useSchedules` and its cache entry with /tasks, which is why it
 * costs the dashboard no poll: the list is re-read just after its soonest run,
 * not on an interval (see `nextScheduleRefetchMs`).
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
  /** The schedule the delete dialog is asking about; null while it is closed. */
  const [deleting, setDeleting] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  const closeDelete = () => {
    setDeleting(null);
    clearError();
  };

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
        // Bounded rather than cut (see glanceSchedules): four rows and half of
        // a fifth, then the list scrolls, so a robot with many schedules does
        // not push Posture off a short rail. The half row is the scroll cue;
        // a height that showed a sliver of one read as a rendering fault.
        <ul className="-mx-1 max-h-48 space-y-0.5 overflow-y-auto">
          {rows.map(({ schedule, next }, index) => (
            <ScheduleGlanceRow
              key={schedule.id}
              schedule={schedule}
              next={next}
              readAtMs={readAtMs}
              // Sorted soonest first, so only the top row can be the next run,
              // and only if it has one — a list of paused rows has none.
              upNext={index === 0 && next !== undefined}
              busy={busy}
              onPause={() => void pause(schedule.id)}
              onResume={() => void resume(schedule.id)}
              onDelete={(name) => {
                clearError();
                setDeleting({ id: schedule.id, name });
              }}
            />
          ))}
        </ul>
      )}

      {/* The read's failure or the last pause / resume refusal, in the
        * backend's own words. A delete's refusal is the dialog's to show. */}
      {error && !deleting && (
        <p role="alert" className="text-[11px] leading-snug text-signal-warn">
          {error}
        </p>
      )}

      {/* The house confirm rather than the browser's: the same dialog the
        * recordings and the map library delete through. A refusal keeps it
        * open with the backend's sentence; a success closes it and the row
        * leaves with the re-read. */}
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) closeDelete();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="wrap-anywhere">
              Delete {deleting?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The robot will stop running it on its own. This cannot be undone —
              it would have to be scheduled again from Tasks.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && deleting && (
            <p role="alert" className="text-[11px] leading-tight text-signal-warn">
              {error}
            </p>
          )}

          <AlertDialogFooter>
            <Button variant="ghost" size="sm" disabled={busy} onClick={closeDelete}>
              <ArrowLeftIcon data-icon="inline-start" />
              Keep
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!deleting) return;
                void remove(deleting.id).then((gone) => {
                  if (gone) setDeleting(null);
                });
              }}
            >
              <Trash2Icon data-icon="inline-start" />
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </InstrumentGroup>
  );
}

/**
 * One schedule on two lines: the name with the whole width to itself, then
 * when it next runs and how often, muted. One line used to hold the name, the
 * time and two buttons, and in a 288 px rail the name was what gave way.
 */
function ScheduleGlanceRow({
  schedule,
  next,
  readAtMs,
  upNext,
  busy,
  onPause,
  onResume,
  onDelete,
}: {
  schedule: ScheduleState;
  next: string | undefined;
  readAtMs: number;
  upNext: boolean;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onDelete: (name: string) => void;
}) {
  // The job it was frozen from names it, as a history row is named; the id is
  // the fallback for a schedule registered without one.
  const name = schedule.task_template_name ?? schedule.id;
  // The snapshot's read time, not the clock, as `now`: the row is a function
  // of the list it came with. An absolute time rather than a countdown for the
  // same reason — "in 28 min" would need a clock of its own to stay true
  // between two reads of a list that is only re-read when a run is due.
  const when = schedule.paused
    ? "paused"
    : next
      ? describeNextRun(new Date(next), new Date(readAtMs))
      : "—";

  return (
    <li
      className={cn(
        // The bar marks what the robot will do next, in the commanded hue —
        // it is something the operator set up, not a reading. Transparent on
        // the other rows so every name starts at the same x.
        "flex items-center gap-1 border-l-2 py-1 pr-0.5 pl-2",
        upNext ? "border-signal-cmd" : "border-transparent",
      )}
    >
      {/* Dimmed rather than badged: a paused schedule is the one that needs
        * the least attention, and a bright chip made it the loudest row. */}
      <div className={cn("min-w-0 flex-1", schedule.paused && "opacity-55")}>
        <p className="flex items-center gap-1 text-[13px] leading-tight">
          {upNext && <span className="sr-only">Up next: </span>}
          {schedule.paused && (
            <PauseIcon className="size-3 shrink-0" aria-hidden />
          )}
          <span className="truncate" title={name}>
            {name}
          </span>
        </p>
        <p className="readout mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
          {when} · {describeTrigger(schedule.trigger)}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for schedule ${name}`}
          title="More actions"
          disabled={busy}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10"
        >
          <EllipsisIcon className="size-3.5" aria-hidden />
        </DropdownMenuTrigger>
        {/* Dressed as the console's own panels rather than shadcn's default
          * popover: the hairline, the small radius and the 12 px type every
          * other surface on this rail uses. Overridden here and not in
          * components/ui, so the task editor's step menu keeps its look. */}
        <DropdownMenuContent
          align="end"
          sideOffset={2}
          className="w-44 rounded-sm border border-hairline bg-panel p-1 shadow-md ring-0"
        >
          {/* Which schedule the menu is about. On a phone the ⋯ is 40 px from
            * the next row's, and the row under a finger is hidden by it. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="instrument-label truncate px-2 pt-1 pb-1.5 text-muted-foreground">
              {name}
            </DropdownMenuLabel>
            {schedule.paused ? (
              <DropdownMenuItem onClick={onResume} className={MENU_ITEM}>
                <PlayIcon aria-hidden />
                Resume
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onPause} className={MENU_ITEM}>
                <PauseIcon aria-hidden />
                Pause
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {/* Set apart from Pause by a rule, in the console's fault hue, so
            * the one act that cannot be undone is never the item a slip of
            * the pointer lands on by accident. */}
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
    </li>
  );
}

/** One menu row at the rail's scale: 28 px tall, 12 px type, 14 px icon. */
const MENU_ITEM =
  "h-7 gap-2 rounded-sm px-2 py-0 text-[12px] focus:bg-elevated focus:text-foreground pointer-coarse:h-10 pointer-coarse:py-0 [&_svg:not([class*='size-'])]:size-3.5";

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
  );
}
