"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";

import { Chip, InstrumentGroup } from "@/components/console/instrument";
import { ScheduleList } from "@/components/tasks/schedule-list";
import { TaskLibrary } from "@/components/tasks/task-library";
import { TemplateScheduleDialog } from "@/components/tasks/template-schedule-form";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useTaskDraft } from "@/hooks/use-task-draft";
import type { TaskTemplate } from "@/lib/api/task-template";
import { draftFromTemplate, draftWouldBeLost } from "@/lib/task/draft-store";
import { fromTemplateSteps, toDispatchSteps, toTemplateSteps } from "@/lib/task/step";
import { TASK_TEMPLATE_NAME_MAX } from "@/lib/task/template";

/**
 * /tasks: the saved tasks by map, each with its schedules, and the Run and
 * Schedule that start one. Building a task is the editor's page
 * (/tasks/editor).
 *
 * A run is not followed here: the masthead's bar shows the running job on
 * every screen, with its step and its Pause and Cancel, and a second readback
 * on this page told the same story by other rules. Only a refused Run is said
 * here, since it never started and the bar never sees it.
 */
export function TaskOverview({ robotId }: { robotId: string | null }) {
  const router = useRouter();
  const [draft, updateDraft] = useTaskDraft();
  const dispatch = useTaskDispatch(robotId);
  const { engaged: stopped } = useConsoleEstop();
  const schedules = useSchedules();
  const library = useTaskTemplates();
  const { maps } = useMaps();
  const activeMap = maps?.find((map) => map.active) ?? null;

  /** Schedules no saved task owns: made from loose steps, or outliving theirs. */
  const orphans =
    library.status === "ok"
      ? schedules.schedules.filter(
          (entry) =>
            !entry.task_template_id ||
            !library.templates.some((template) => template.id === entry.task_template_id),
        )
      : [];

  /**
   * Replacing unsaved work is asked about; declining still opens the editor
   * on the kept work. Reopening the loaded task keeps its edits.
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

  /** By id, so a task deleted meanwhile closes its dialog. */
  const [schedulingId, setSchedulingId] = React.useState<string | null>(null);
  const scheduling =
    library.templates.find((template) => template.id === schedulingId) ?? null;

  const run = (template: TaskTemplate) => {
    // Not loaded into the editor, which would discard the draft. The name
    // labels the job in history; the map lets the backend refuse a map
    // switched since this list was read.
    void dispatch.send(toDispatchSteps(template.steps), template.name, template.map_name);
  };

  /** The editor's Save as copy, from the card: the same steps under a new name. */
  const duplicate = (template: TaskTemplate) => {
    void library.create({
      name: `${template.name} (copy)`.slice(0, TASK_TEMPLATE_NAME_MAX),
      map_name: template.map_name,
      steps: toTemplateSteps(fromTemplateSteps(template.steps)),
    });
  };

  const remove = (template: TaskTemplate) => {
    const owned = schedules.schedules.filter(
      (entry) => entry.task_template_id === template.id,
    ).length;
    // A confirm, since there is no undo; it names the schedules because they
    // keep running on their own copy of the steps.
    const keeps =
      owned === 0
        ? ""
        : ` ${owned === 1 ? "Its schedule keeps" : `Its ${owned} schedules keep`} running until deleted.`;
    if (!window.confirm(`Delete "${template.name}"? This cannot be undone.${keeps}`)) return;
    void library.remove(template.id).then((gone) => {
      // Unlink the editor; its steps stay, to save as new.
      if (!gone) return;
      updateDraft((current) =>
        current.editing?.id === template.id ? { ...current, editing: null } : current,
      );
    });
  };

  const scheduleActions = {
    readAtMs: schedules.readAtMs,
    busy: schedules.busy,
    onPause: (id: string) => void schedules.pause(id),
    onResume: (id: string) => void schedules.resume(id),
    onDelete: (id: string) => void schedules.remove(id),
  };

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
        <InstrumentGroup
          label="Saved tasks"
          action={
            <div className="flex items-center gap-1.5">
              <Chip tone={library.templates.length ? "neutral" : "caution"}>
                {library.templates.length}
              </Chip>
              <button
                type="button"
                aria-label="Refresh saved tasks"
                title="Refresh saved tasks"
                disabled={library.busy || schedules.busy}
                onClick={() => {
                  library.refresh();
                  schedules.refresh();
                }}
                className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 pointer-coarse:size-10"
              >
                <RefreshCwIcon className="size-3.5" aria-hidden />
              </button>
            </div>
          }
        >
          {library.error && <Alert>{library.error}</Alert>}
          {schedules.error && <Alert>{schedules.error}</Alert>}
          {/* A refused Run never started, so the masthead never shows it. */}
          {dispatch.refused && <Alert>{dispatch.refused}</Alert>}
          <TaskLibrary
            templates={library.templates}
            schedules={schedules.schedules}
            scheduleActions={scheduleActions}
            status={library.status}
            busy={library.busy}
            activeMapName={activeMap?.name ?? null}
            runDisabled={dispatch.running || robotId === null || stopped}
            onRun={run}
            onEdit={openInEditor}
            onSchedule={(template) => setSchedulingId(template.id)}
            onDuplicate={duplicate}
            onDelete={remove}
          />
        </InstrumentGroup>

        {/* Still running, so never hidden; but no card can hold them. */}
        {orphans.length > 0 && (
          <InstrumentGroup
            label="Schedules no saved task owns"
            caption="These run steps that are not a saved task, so they are listed apart. Delete one, and schedule a task in its place, to see it on its card."
          >
            <ScheduleList
              schedules={orphans}
              source={null}
              templates={library.templates}
              {...scheduleActions}
            />
          </InstrumentGroup>
        )}
      </div>

      <TemplateScheduleDialog
        template={scheduling}
        existingIds={schedules.schedules.map((entry) => entry.id)}
        onScheduled={() => setSchedulingId(null)}
        onClose={() => setSchedulingId(null)}
      />
    </>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
      {children}
    </p>
  );
}
