"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";

import { Chip, InstrumentGroup } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { ScheduleList } from "@/components/tasks/schedule-list";
import { TaskLibrary } from "@/components/tasks/task-library";
import { TemplateScheduleForm } from "@/components/tasks/template-schedule-form";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useTaskDraft } from "@/hooks/use-task-draft";
import type { TaskTemplate } from "@/lib/api/task-template";
import { dispatchMapLock } from "@/lib/map/run-lock";
import { draftFromTemplate, draftWouldBeLost } from "@/lib/task/draft-store";
import { toDispatchSteps } from "@/lib/task/step";

/**
 * /tasks: the saved jobs, then the registered schedules, and the run a row
 * starts. Building a job is the editor's page (/tasks/editor).
 *
 * Run and Schedule stay here, where the run's tracker and the schedule list
 * are; Load writes the template into the tab's draft and navigates.
 */
export function TaskOverview({ robotId }: { robotId: string | null }) {
  const router = useRouter();
  const [draft, updateDraft] = useTaskDraft();
  const dispatch = useTaskDispatch(robotId);
  const { engaged: stopped } = useConsoleEstop();
  const schedules = useSchedules();
  const library = useTaskTemplates();
  const { maps } = useMaps();
  const activeMapName = maps?.find((map) => map.active)?.name ?? null;

  /** Which row shows the run's readback; a row gone mid-run just shows none. */
  const [dispatchedFrom, setDispatchedFrom] = React.useState<string | null>(null);

  /**
   * Schedules naming no template (registered from loose steps, or from before
   * the memo carried provenance), counted in the library's footnote instead.
   */
  const unlinkedScheduleCount = schedules.schedules.filter(
    (entry) => !entry.task_template_id,
  ).length;

  /**
   * Replacing unsaved work is asked about; declining still opens the editor
   * on the kept work. Reopening the loaded template keeps its edits.
   */
  const openInEditor = (template: TaskTemplate) => {
    const keep =
      draft.editing?.id === template.id ||
      (draftWouldBeLost(draft, template.id, library.templates) &&
        !window.confirm(
          `Open "${template.name}"? The unsaved changes in the editor will be replaced.`,
        ));
    if (!keep) updateDraft((current) => draftFromTemplate(current, template));
    router.push("/tasks/editor");
  };

  /**
   * The job whose schedules are lit after its clock chip was pressed. A flash,
   * not a selection, so the list has no extra state to explain.
   */
  const [highlighted, setHighlighted] = React.useState<string | null>(null);
  const scheduleFrame = React.useRef<HTMLDivElement>(null);
  const highlightTimer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const flash = (templateId: string) => {
    setHighlighted(templateId);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlighted(null), 2500);
  };

  const showSchedules = (template: TaskTemplate) => {
    flash(template.id);
    // Focus the first row so a keyboard or screen reader lands where the eye
    // was sent; the rows are already rendered.
    const first = scheduleFrame.current?.querySelector<HTMLElement>(
      `[data-template-id="${CSS.escape(template.id)}"]`,
    );
    if (!first) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    first.focus({ preventScroll: true });
  };

  /** By id, so a job deleted meanwhile closes its form. */
  const [schedulingId, setSchedulingId] = React.useState<string | null>(null);
  const scheduling =
    library.templates.find((template) => template.id === schedulingId) ?? null;

  const dispatchTemplate = (template: TaskTemplate) => {
    setDispatchedFrom(template.id);
    // Not loaded into the editor, which would discard the draft. The name
    // labels the run in history; the map lets the backend refuse a map
    // switched since this list was read.
    void dispatch.send(
      toDispatchSteps(template.steps),
      template.name,
      template.map_name,
    );
  };

  /** Why a row's Run is held by its map, beyond the wrong-map gate; see dispatchMapLock. */
  const dispatchLockFor = (template: TaskTemplate): string | null =>
    template.map_name === null
      ? null
      : dispatchMapLock(maps?.find((map) => map.name === template.map_name) ?? null)
          .reason;

  return (
    <>
      {/* First: a run this page is not following is the most urgent news.
        * One started from a row here is followed by the row. */}
      <ActiveRunBanner trackedTaskId={dispatch.taskId} />

      <div className="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
        <InstrumentGroup
          label="Saved jobs"
          action={
            <div className="flex items-center gap-1.5">
              <Chip tone={library.templates.length ? "neutral" : "caution"}>
                {library.templates.length}
              </Chip>
              <button
                type="button"
                aria-label="Refresh saved jobs"
                title="Refresh saved jobs"
                disabled={library.busy}
                onClick={library.refresh}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40"
              >
                <RefreshCwIcon className="size-3.5" aria-hidden />
              </button>
            </div>
          }
        >
          {library.error && (
            <p
              role="alert"
              className="text-[11px] leading-snug break-words text-signal-warn"
            >
              {library.error}
            </p>
          )}
          {/* A refused Run never started, so has no row readback to say it in. */}
          {dispatch.refused && (
            <p
              role="alert"
              className="text-[11px] leading-snug break-words text-signal-warn"
            >
              {dispatch.refused}
            </p>
          )}
          <TaskLibrary
            templates={library.templates}
            schedules={schedules.schedules}
            unlinkedScheduleCount={unlinkedScheduleCount}
            status={library.status}
            busy={library.busy}
            activeMapName={activeMapName}
            dispatchDisabled={dispatch.running || robotId === null || stopped}
            dispatchLockFor={dispatchLockFor}
            dispatchedFromId={dispatchedFrom}
            taskStatus={dispatch.taskStatus}
            stepStates={dispatch.stepStates}
            onDispatch={dispatchTemplate}
            onLoad={openInEditor}
            onSchedule={(template) => setSchedulingId(template.id)}
            onShowSchedules={showSchedules}
            onDelete={(template) => {
              // A confirm, since there is no undo.
              if (
                window.confirm(
                  `Delete task template "${template.name}"? This cannot be undone.`,
                )
              ) {
                void library.remove(template.id).then((gone) => {
                  // Unlink the editor; its steps stay, to save as new.
                  if (!gone) return;
                  updateDraft((current) =>
                    current.editing?.id === template.id
                      ? { ...current, editing: null }
                      : current,
                  );
                });
              }
            }}
          />
        </InstrumentGroup>
      </div>

      {/* Always shown, so an empty list says so. */}
      <div
        ref={scheduleFrame}
        className="mb-4 overflow-hidden rounded-md border border-hairline bg-panel"
      >
        <InstrumentGroup
          label="Registered schedules"
          action={
            <button
              type="button"
              aria-label="Refresh schedules"
              title="Refresh schedules"
              disabled={schedules.busy}
              onClick={schedules.refresh}
              className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40"
            >
              <RefreshCwIcon className="size-3.5" aria-hidden />
            </button>
          }
        >
          {scheduling && (
            <TemplateScheduleForm
              // One form per job: switching rows starts a fresh one.
              key={scheduling.id}
              template={scheduling}
              existingIds={schedules.schedules.map((entry) => entry.id)}
              onScheduled={() => {
                setSchedulingId(null);
                // Light the job's rows to show which one just arrived.
                flash(scheduling.id);
              }}
              onCancel={() => setSchedulingId(null)}
            />
          )}
          <ScheduleList
            schedules={schedules.schedules}
            readAtMs={schedules.readAtMs}
            templates={library.templates}
            status={schedules.status}
            busy={schedules.busy}
            onPause={schedules.pause}
            onResume={schedules.resume}
            onDelete={schedules.remove}
            highlightTemplateId={highlighted}
          />
        </InstrumentGroup>
      </div>
    </>
  );
}
