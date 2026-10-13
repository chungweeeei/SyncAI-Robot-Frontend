"use client";

import * as React from "react";
import {
  CalendarPlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { TaskStatusChip } from "@/components/console/task-chip";
import { GroupRail } from "@/components/tasks/group-rail";
import { IconButton } from "@/components/tasks/icon-button";
import type { ScheduleState } from "@/lib/api/schedule";
import type { TemplateStep, TaskTemplate } from "@/lib/api/task-template";
import type { TaskStepState } from "@/lib/api/task";
import { describeTrigger, scheduleChipSummary } from "@/lib/task/schedule";
import {
  repeatSuffix,
  stepGlyph,
  stepShape,
  wireGroupPlaces,
  type GroupPlace,
} from "@/lib/task/step";
import { cn } from "@/lib/utils";

export interface TaskTemplateRowProps {
  template: TaskTemplate;
  /** The map the robot is on, for the mismatch sentence. Null when none loaded. */
  activeMapName: string | null;
  /** True while any task is in flight, or the robot id is not known yet. */
  dispatchDisabled: boolean;
  /** Why this job's map cannot take a job now; shown so a greyed Run does not read as broken. */
  dispatchLock: string | null;
  /** Per-step state, but only when *this* row is the one that was dispatched. */
  stepStates: ReadonlyMap<string, TaskStepState> | null;
  /** Task-level status of the run this row started, or null. */
  taskStatus: React.ComponentProps<typeof TaskStatusChip>["status"] | null;
  /** The schedules frozen from this template; empty for a one-time job. */
  schedules: readonly ScheduleState[];
  busy: boolean;
  onDispatch: () => void;
  onLoad: () => void;
  onSchedule: () => void;
  onDelete: () => void;
  /** Point at this row's schedules in the Registered schedules list. */
  onShowSchedules: () => void;
}

/**
 * One library row. Actions are bare icon buttons rather than a menu, like the
 * console's other lists, keeping tap targets large.
 */
export function TaskTemplateRow({
  template,
  activeMapName,
  dispatchDisabled,
  dispatchLock,
  stepStates,
  taskStatus,
  schedules,
  busy,
  onDispatch,
  onLoad,
  onSchedule,
  onDelete,
  onShowSchedules,
}: TaskTemplateRowProps) {
  const [open, setOpen] = React.useState(false);
  const groupPlaces = wireGroupPlaces(template.steps);
  const railed = groupPlaces.some(Boolean);

  /**
   * One chip for all this template's schedules. A button that lights them in
   * the list below; the hover title lists them for a mouse.
   */
  const schedule = scheduleChipSummary(schedules);
  const scheduleTitle = schedules
    .map(
      (entry) =>
        `${entry.id}: ${describeTrigger(entry.trigger)}${entry.paused ? " (paused)" : ""}`,
    )
    .join("\n");

  // The hard gate: another map's coordinates point elsewhere on the loaded one.
  // A missing vertex only falls back to the snapshot.
  const wrongMap = template.map_name !== null && !template.map_matches_active;
  const blocked = wrongMap || dispatchDisabled || dispatchLock !== null;

  return (
    <li className="rounded-sm border border-hairline bg-elevated/40 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={open ? "Hide steps" : "Show steps"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-3.5" aria-hidden />
          )}
        </button>

        <span className="readout min-w-0 flex-1 truncate text-[13px]">
          {template.name}
        </span>

        {/* The shape at a glance: M M S is a route, [M T] two steps together. */}
        <span
          className="readout min-w-0 max-w-full truncate text-[11px] tracking-wider text-muted-foreground"
          aria-label={`${template.steps.length} steps`}
        >
          {stepShape(template.steps)}
        </span>

        {/* Before the map chip: running unattended outranks which map. */}
        {schedule && (
          <button
            type="button"
            onClick={onShowSchedules}
            aria-label={`Show the schedules for "${template.name}": ${schedule.label}`}
            title={scheduleTitle}
            className="shrink-0 rounded-sm transition-opacity hover:opacity-80 pointer-coarse:min-h-10"
          >
            <Chip tone={schedule.tone} className="gap-1">
              <ClockIcon className="size-3" aria-hidden />
              {schedule.label}
            </Chip>
          </button>
        )}
        {template.map_name && (
          <Chip tone={wrongMap ? "caution" : "neutral"}>{template.map_name}</Chip>
        )}
        {template.missing_vertex_count > 0 && (
          <Chip tone="caution">{template.missing_vertex_count} missing</Chip>
        )}
        {taskStatus && <TaskStatusChip status={taskStatus} />}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            label={`Dispatch "${template.name}" now`}
            disabled={blocked || busy}
            onClick={onDispatch}
            className="text-signal-cmd hover:bg-signal-cmd/12"
          >
            <SendIcon className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label={`Load "${template.name}" into the editor`}
            // Allowed for another map's job too: fixing it is the next thing to do.
            disabled={busy}
            onClick={onLoad}
          >
            <PencilIcon className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label={`Schedule "${template.name}"`}
            disabled={wrongMap || busy}
            onClick={onSchedule}
          >
            <CalendarPlusIcon className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label={`Delete "${template.name}"`}
            disabled={busy}
            className="text-signal-warn hover:bg-signal-warn/12"
            onClick={onDelete}
          >
            <Trash2Icon className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      </div>

      {wrongMap && (
        <p className="mt-1 pl-7 text-[11px] leading-tight text-signal-caution">
          Saved for <span className="readout">{template.map_name}</span>; the robot has{" "}
          <span className="readout">{activeMapName ?? "no map"}</span> loaded.
        </p>
      )}
      {!wrongMap && dispatchLock && (
        <p className="mt-1 pl-7 text-[11px] leading-tight text-signal-caution">
          {dispatchLock}
        </p>
      )}

      {open && (
        <ol className={cn("mt-1.5 space-y-0.5", railed ? "pl-4.5" : "pl-7")}>
          {template.steps.map((step, index) => (
            <TemplateStepLine
              key={step.id}
              step={step}
              index={index}
              place={groupPlaces[index] ?? null}
              railed={railed}
              state={stepStates?.get(step.id) ?? null}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function TemplateStepLine({
  step,
  index,
  place,
  railed,
  state,
}: {
  step: TemplateStep;
  index: number;
  place: GroupPlace;
  /** The list has a group, so every line reserves the rail's column. */
  railed: boolean;
  state: TaskStepState | null;
}) {
  return (
    <li className={cn("flex items-baseline gap-2 text-[11px]", railed && "relative pl-2.5")}>
      <GroupRail place={place} gap="0.5" />
      <span className="readout w-3 shrink-0 text-muted-foreground">{index + 1}</span>
      <span className="instrument-label w-3 shrink-0 text-muted-foreground">
        {stepGlyph(step.type)}
      </span>
      {step.vertex_name && (
        <span
          className={
            step.vertex_status === "MISSING"
              ? "readout shrink-0 text-signal-caution line-through"
              : "readout shrink-0 text-muted-foreground"
          }
        >
          {step.vertex_name}
        </span>
      )}
      {/* A chip, since a finger cannot hover to ask what the strike means. */}
      {step.vertex_status === "MISSING" && (
        <Chip
          tone="caution"
          title="This waypoint has been deleted. The robot will use the position it had when the job was saved."
        >
          deleted
        </Chip>
      )}
      {/* resolved_params, not params: what a dispatch would actually send. */}
      {step.type === "MOVE" && step.resolved_params && (
        <span className="readout min-w-0 truncate">
          {step.resolved_params.x.toFixed(3)}, {step.resolved_params.y.toFixed(3)} ·{" "}
          {step.resolved_params.theta.toFixed(1)}°
        </span>
      )}
      {/* Wrapped, not truncated: the expanded detail has vertical room. */}
      {step.type === "SPEAK" && step.resolved_params && (
        <span className="min-w-0 wrap-anywhere italic">
          “{step.resolved_params.text}”{repeatSuffix(step.resolved_params.repeat)}
        </span>
      )}
      {step.type === "WAIT" && step.resolved_params && (
        <span className="readout">{step.resolved_params.seconds} s</span>
      )}
      {state?.message && (
        <span className="min-w-0 truncate text-muted-foreground">{state.message}</span>
      )}
      {state && <TaskStatusChip status={state.status} />}
    </li>
  );
}
