"use client";

import * as React from "react";
import {
  CalendarPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/tasks/icon-button";
import { ScheduleList, type ScheduleActions } from "@/components/tasks/schedule-list";
import { useStepCatalogue } from "@/hooks/use-step-catalogue";
import type { ScheduleState } from "@/lib/api/schedule";
import type { TemplateStep, TaskTemplate } from "@/lib/api/task-template";
import { stepSpec } from "@/lib/task/catalogue";
import {
  routeLine,
  routeStops,
  taskStops,
  taskSummary,
  type RouteStop,
} from "@/lib/task/library";
import { repeatSuffix } from "@/lib/task/step";
import { formatDuration } from "@/lib/task/stops";

export interface TaskTemplateRowProps {
  template: TaskTemplate;
  /** A write to the library is in flight. */
  busy: boolean;
  /** The task's map is not the loaded one, or is held; the group says why. */
  runBlocked: boolean;
  /** As `runBlocked`, for Schedule: only another map holds it. */
  scheduleBlocked: boolean;
  /** The schedules made from this task; empty for one run by hand. */
  schedules: readonly ScheduleState[];
  /** Pause, resume, delete: the schedule list's own, with its own busy. */
  scheduleActions: ScheduleActions;
  onRun: () => void;
  onSchedule: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * One saved task. Folded, it is what an engineer on site recognises a task
 * by: its name and the waypoints it walks, with no step letters to decode.
 * Its schedules are a line each under the route, folded or not; opened, the
 * card adds the stops it was built from, read-only.
 *
 * Run and Schedule are labelled buttons and Delete sits in the ⋯ menu: the
 * page exists to run and schedule tasks, and a delete beside them at the same
 * size was one slip of a finger from the button meant.
 */
export function TaskTemplateRow({
  template,
  runBlocked,
  scheduleBlocked,
  schedules,
  busy,
  onRun,
  onSchedule,
  onEdit,
  onDuplicate,
  onDelete,
  scheduleActions,
}: TaskTemplateRowProps) {
  const [open, setOpen] = React.useState(false);
  const detailId = React.useId();

  return (
    <li className="rounded-sm border border-hairline bg-elevated/40 px-2 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* The name opens the card; Edit is its own button. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 rounded-sm text-left transition-colors hover:text-foreground pointer-coarse:min-h-10"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="readout min-w-0 truncate text-[13px]">{template.name}</span>
        </button>

        {template.missing_vertex_count > 0 && (
          <Chip tone="caution">{template.missing_vertex_count} missing</Chip>
        )}

        {/* Below sm the buttons take a row of their own under the route, so
          * the route stays under the name it describes. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:order-last">
          <Button
            size="sm"
            aria-label={`Run "${template.name}" now`}
            disabled={runBlocked || busy}
            onClick={onRun}
            className="bg-signal-cmd text-background hover:bg-signal-cmd/85"
          >
            <PlayIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Run</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`Schedule "${template.name}"`}
            disabled={scheduleBlocked || busy}
            onClick={onSchedule}
          >
            <CalendarPlusIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Schedule</span>
          </Button>
          <IconButton
            label={`Edit "${template.name}"`}
            // Allowed for another map's task too: fixing it is the next thing to do.
            disabled={busy}
            onClick={onEdit}
          >
            <PencilIcon className="size-3.5" aria-hidden />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`More for "${template.name}"`}
              disabled={busy}
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-30 pointer-coarse:size-10"
            >
              <EllipsisIcon className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onDuplicate}>
                <CopyIcon aria-hidden />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon aria-hidden />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <TaskRoute steps={template.steps} />
      </div>

      {schedules.length > 0 && (
        <section aria-label={`Schedules for "${template.name}"`} className="mt-1.5 pl-5">
          <ScheduleList
            schedules={schedules}
            source={template}
            templates={[template]}
            checkDrift={open}
            {...scheduleActions}
          />
        </section>
      )}

      {open && (
        <div id={detailId} className="mt-2 space-y-3 border-t border-hairline pt-2 pl-5">
          <TaskStopsView steps={template.steps} />
        </div>
      )}
    </li>
  );
}

/** `lobby → hall → charger · 3 stops · 1 min 30 s of waiting · ends docked`. */
function TaskRoute({ steps }: { steps: readonly TemplateStep[] }) {
  const stops = routeStops(steps);
  const summary = taskSummary(steps);
  const parts = [
    summary.stops === 0
      ? `no stops · ${steps.length} ${steps.length === 1 ? "action" : "actions"}`
      : `${summary.stops} ${summary.stops === 1 ? "stop" : "stops"}`,
    summary.waitSeconds > 0 ? `${formatDuration(summary.waitSeconds)} of waiting` : null,
    summary.endsDocked ? "ends docked" : null,
  ].filter((part): part is string => part !== null);

  return (
    <p className="flex min-w-0 basis-full flex-wrap items-baseline gap-x-2 pl-5 text-[11px] leading-snug text-muted-foreground">
      {stops.length > 0 && (
        <span className="readout min-w-0 text-foreground/80" aria-label="Route">
          {routeLine(stops).map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span aria-hidden> → </span>}
              {"hidden" in item ? (
                <span>+{item.hidden}</span>
              ) : (
                <StopName stop={item} />
              )}
            </React.Fragment>
          ))}
        </span>
      )}
      <span>{parts.join(" · ")}</span>
    </p>
  );
}

function StopName({ stop }: { stop: RouteStop }) {
  const name = stop.name ?? "a waypoint";
  if (!stop.missing) return <span>{name}</span>;
  return (
    <span
      className="text-signal-caution line-through"
      title="This waypoint has been deleted. The robot will use the position it had when the task was saved."
    >
      {name}
    </span>
  );
}

/** The stops as the editor showed them, read-only: no coordinates, no letters. */
function TaskStopsView({ steps }: { steps: readonly TemplateStep[] }) {
  const catalogue = useStepCatalogue();
  const label = (step: TemplateStep) => stepSpec(catalogue, step.type)?.label ?? step.type;
  const read = taskStops(steps);

  return (
    <ol className="space-y-2" aria-label="Stops">
      {read.start.length > 0 && (
        <li>
          <ActionRun heading="Before setting off" steps={read.start} label={label} />
        </li>
      )}
      {read.stops.map((stop, index) => {
        const place = stop.step.vertex_name ?? "a waypoint";
        return (
          <li key={stop.step.id} className="space-y-1">
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="readout w-4 shrink-0 text-muted-foreground">{index + 1}</span>
              <span className="instrument-label w-10 shrink-0 text-muted-foreground">
                {label(stop.step)}
              </span>
              <StopName
                stop={{
                  name: stop.step.vertex_name,
                  missing: stop.step.vertex_status === "MISSING",
                  dock: stop.step.type === "DOCK",
                }}
              />
              {/* A chip, since a finger cannot hover to ask what the strike means. */}
              {stop.step.vertex_status === "MISSING" && <Chip tone="caution">deleted</Chip>}
            </div>
            {stop.transit.length > 0 && (
              <ActionRun heading={`On the way to ${place}`} steps={stop.transit} label={label} />
            )}
            {stop.arrival.length > 0 && (
              <ActionRun heading={`At ${place}`} steps={stop.arrival} label={label} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ActionRun({
  heading,
  steps,
  label,
}: {
  heading: string;
  steps: readonly TemplateStep[];
  label: (step: TemplateStep) => string;
}) {
  return (
    <div className="ml-6 space-y-0.5">
      <p className="instrument-label text-muted-foreground">{heading}</p>
      <ul className="space-y-0.5">
        {steps.map((step) => (
          <li key={step.id} className="flex items-baseline gap-2 text-[11px]">
            <span className="w-16 shrink-0">{label(step)}</span>
            <ActionDetail step={step} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionDetail({ step }: { step: TemplateStep }) {
  if (step.type === "SPEAK" && step.resolved_params) {
    // Wrapped, not truncated: the opened card has vertical room.
    return (
      <span className="min-w-0 wrap-anywhere italic">
        “{step.resolved_params.text}”{repeatSuffix(step.resolved_params.repeat)}
      </span>
    );
  }
  if (step.type === "WAIT" && step.resolved_params) {
    return <span className="readout">{formatDuration(step.resolved_params.seconds)}</span>;
  }
  return null;
}
