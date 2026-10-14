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
 * What the robot will do on its own, at the top of the rail: name, next run,
 * cadence, and Pause / Delete (by request). Editing stays on /tasks.
 *
 * Actions sit behind one ⋯ per row: rows are read far more than acted on, and
 * a Delete beside Pause is one a finger hits by mistake.
 *
 * Shares `useSchedules` with /tasks, so it costs no poll: the list is re-read
 * just after its soonest run (see `nextScheduleRefetchMs`).
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
        // An icon, by request; the words are on the name and tooltip.
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
        // Four and a half rows, then it scrolls; the half row is the scroll
        // cue (a sliver read as a rendering fault).
        <ul className="-mx-1 max-h-48 space-y-0.5 overflow-y-auto">
          {rows.map(({ schedule, next }, index) => (
            <ScheduleGlanceRow
              key={schedule.id}
              schedule={schedule}
              next={next}
              readAtMs={readAtMs}
              // Sorted soonest first; a list of paused rows has no next run.
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

      {/* A delete's refusal is the dialog's to show. */}
      {error && !deleting && (
        <p role="alert" className="text-[11px] leading-snug text-signal-warn">
          {error}
        </p>
      )}

      {/* A refusal keeps it open with the backend's sentence. */}
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

/** One schedule on two lines, so the name has the rail's width to itself. */
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
  const name = schedule.task_template_name ?? schedule.id;
  // Measured from the snapshot's read time, and absolute rather than a
  // countdown, which would need its own clock between re-reads.
  const when = schedule.paused
    ? "paused"
    : next
      ? describeNextRun(new Date(next), new Date(readAtMs))
      : "—";

  return (
    <li
      className={cn(
        // The bar marks the next run; transparent elsewhere to keep names aligned.
        "flex items-center gap-1 border-l-2 py-1 pr-0.5 pl-2",
        upNext ? "border-signal-cmd" : "border-transparent",
      )}
    >
      {/* Dimmed, not badged: a chip made the least urgent row the loudest. */}
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
          {/* Ruled off from Pause so a slip cannot land on it. */}
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
