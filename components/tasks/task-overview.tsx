"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";

import { Chip, InstrumentGroup } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { ScheduleList } from "@/components/tasks/schedule-list";
import { TaskLibrary } from "@/components/tasks/task-library";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useTaskDraft } from "@/hooks/use-task-draft";
import type { TaskTemplate } from "@/lib/api/task-template";
import {
  draftFromTemplate,
  draftWouldBeLost,
  type TaskEditorMode,
} from "@/lib/task/draft-store";
import { toDispatchSteps } from "@/lib/task/step";

/**
 * /tasks: what this robot already has — the saved jobs and the registered
 * schedules — and the run a library row starts. Building or changing a job is
 * the editor's page (TaskEditor, /tasks/editor).
 *
 * **The library is first.** The complaint this answers is that returning to
 * the page showed nothing saved, so the first thing under the header has to
 * answer "what do I have". The schedules sit right under it because they
 * answer the same question for what runs unattended.
 *
 * **Run stays here; Edit and Schedule go to the editor.** A row's Run
 * dispatches the saved template as it is, and the tracker that reports its
 * steps back belongs to this mount, so the row's readback works without a trip
 * anywhere. Edit and Schedule both need the editor — the schedule's trigger is
 * only authored there — so they write the template into the tab's draft and
 * navigate.
 */
export function TaskOverview({ robotId }: { robotId: string | null }) {
  const router = useRouter();
  const [draft, updateDraft] = useTaskDraft();
  const dispatch = useTaskDispatch(robotId);
  const schedules = useSchedules();
  const library = useTaskTemplates();
  const { maps } = useMaps();
  const activeMapName = maps?.find((map) => map.active)?.name ?? null;

  /**
   * Which template the in-flight run came from; null before any row has run.
   * Only used to decide which library row shows the readback, so the
   * two degenerate cases (row deleted mid-run, row not in the current scope)
   * resolve to "no badge" rather than to a lost run.
   */
  const [dispatchedFrom, setDispatchedFrom] = React.useState<string | null>(null);

  /**
   * Schedules that name no template, i.e. the ones registered from loose steps
   * through `POST /api/v1/schedules`. Nothing ties them to a library row, so
   * they are counted in the library's footnote instead — see TaskLibrary.
   *
   * (Older schedules can also land here: the provenance did not always exist in
   * the memo, so one registered before it did reads as unlinked whatever it was
   * made from.)
   */
  const unlinkedScheduleCount = schedules.schedules.filter(
    (entry) => !entry.task_template_id,
  ).length;

  /**
   * Open a saved job in the editor. The draft is on another page from here,
   * so replacing steps the operator built is asked about rather than done;
   * declining still goes to the editor, on the work they kept. Reopening the
   * template already loaded keeps its unsaved edits and only sets the mode.
   */
  const openInEditor = (template: TaskTemplate, mode: TaskEditorMode) => {
    const keep =
      draft.editing?.id === template.id ||
      (draftWouldBeLost(draft, template.id) &&
        !window.confirm(
          `Open "${template.name}"? The unsaved steps in the editor will be replaced.`,
        ));
    updateDraft((current) =>
      keep ? { ...current, mode } : draftFromTemplate(current, template, mode),
    );
    router.push("/tasks/editor");
  };

  const dispatchTemplate = (template: TaskTemplate) => {
    setDispatchedFrom(template.id);
    // Deliberately does NOT load the template into the editor: that would
    // silently discard whatever the operator was authoring, which is the same
    // class of data loss the draft exists to prevent.
    void dispatch.send(toDispatchSteps(template.steps));
  };

  return (
    <>
      {/* Above the library, because it is the most urgent thing this screen can
        * say: a robot is executing something this page is not following. A
        * run started from a library row here is followed by the row itself. */}
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
          <TaskLibrary
            templates={library.templates}
            schedules={schedules.schedules}
            unlinkedScheduleCount={unlinkedScheduleCount}
            status={library.status}
            busy={library.busy}
            activeMapName={activeMapName}
            dispatchDisabled={dispatch.running || robotId === null}
            dispatchedFromId={dispatchedFrom}
            taskStatus={dispatch.taskStatus}
            stepStates={dispatch.stepStates}
            onDispatch={dispatchTemplate}
            onLoad={(template) => openInEditor(template, "now")}
            // The trigger is authored in the editor's Schedule pane, which is
            // the only place a timed/interval form exists. Loading the template
            // first is what makes that pane describe the thing being scheduled.
            onSchedule={(template) => openInEditor(template, "schedule")}
            onDelete={(template) => {
              // A confirm rather than an undo: there is no local history to step
              // back over. Same stance as the vertex panel and the schedule list.
              if (
                window.confirm(
                  `Delete task template "${template.name}"? This cannot be undone.`,
                )
              ) {
                void library.remove(template.id).then((gone) => {
                  // The editor's link to a row that is gone; its steps stay,
                  // to be saved as new if they are still wanted.
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

      {/* Its own frame, because the registered schedules are a different object
       * from the saved jobs: one is what could run, the other what will run on
       * its own. Always shown, so an empty list says so rather than leaving
       * the operator to wonder whether anything is registered. */}
      <div className="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
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
            <ScheduleList
              schedules={schedules.schedules}
              readAtMs={schedules.readAtMs}
              templates={library.templates}
              status={schedules.status}
              busy={schedules.busy}
              onPause={schedules.pause}
              onResume={schedules.resume}
              onDelete={schedules.remove}
            />
          </InstrumentGroup>
        </div>
    </>
  );
}
