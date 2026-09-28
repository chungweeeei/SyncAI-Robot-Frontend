"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, MapPinPlusIcon, XIcon } from "lucide-react";

import { InstrumentGroup, Segmented } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { DispatchPanel } from "@/components/tasks/dispatch-panel";
import { MapPicker } from "@/components/tasks/map-picker";
import { SaveGroup } from "@/components/tasks/save-group";
import { ScheduleForm } from "@/components/tasks/schedule-form";
import { StepList } from "@/components/tasks/step-list";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useScheduleTaskTemplate, useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { waypointEditorHref } from "@/lib/map/links";
import type { TaskDraft, TaskEditorMode } from "@/lib/task/draft-store";
import {
  stepDraftsSubmittable,
  toStepRequests,
  toTemplateSteps,
} from "@/lib/task/step";

type TaskMode = TaskEditorMode;

const MODE_OPTIONS = [
  { value: "now", label: "Run now" },
  { value: "schedule", label: "On a schedule" },
] as const satisfies readonly { value: TaskMode; label: string }[];

/**
 * The task editor, on a page of its own (/tasks/editor): the steps being
 * authored, and everything done with them — name and save, then run now or
 * register on a schedule.
 *
 * **Its own route, off the overview.** It used to fold away under the library
 * on /tasks, and splitting it out was rejected once because the App Router
 * unmounts on navigation, losing the tracked id of a run this tab started.
 * What that costs now is only the per-step readback: ActiveRunBanner recovers
 * any run from GET /api/v1/active_tasks, with its Cancel, on either page. And
 * the draft already outlives a navigation (lib/task/draft-store.ts), so the
 * overview hands a template over by writing it into the draft and pushing
 * here — there is no id in the URL to keep in step with it.
 *
 * **Two columns.** The step list takes the wide column; everything you *do*
 * with it rides in a narrower one that sticks to the top of the viewport while
 * the steps scroll, so the button that runs the thing is never a scroll below
 * the thing. Below `lg` the grid is one column again and the reading order
 * falls back to the sentence being composed: these steps → when → go.
 *
 * Switching modes never touches what was authored — the step list is outside
 * both panes.
 */
export function TaskEditor({ robotId }: { robotId: string | null }) {
  const router = useRouter();
  /**
   * Everything authored and not yet saved — the steps, the loaded template,
   * the map override and the name being typed — lives in the tab's task draft
   * rather than in this component's state, so leaving for the map editor to
   * place a missing stop and coming back finds the job as it was. The setters
   * below keep the call sites reading like state.
   */
  const [draft, updateDraft, clearDraft] = useTaskDraft();
  const { mode, editing, chosenMap, name: draftName } = draft;
  const setMode = React.useCallback(
    (mode: TaskMode) => updateDraft((current) => ({ ...current, mode })),
    [updateDraft],
  );
  const setChosenMap = React.useCallback(
    (chosenMap: string | null) => updateDraft((current) => ({ ...current, chosenMap })),
    [updateDraft],
  );
  const setDraftName = React.useCallback(
    (name: string) => updateDraft((current) => ({ ...current, name })),
    [updateDraft],
  );
  const setSteps = React.useCallback(
    (change: (current: TaskDraft["steps"]) => TaskDraft["steps"]) =>
      updateDraft((current) => ({ ...current, steps: change(current.steps) })),
    [updateDraft],
  );
  const drafts = useStepDrafts(draft.steps, setSteps);
  const dispatch = useTaskDispatch(robotId);
  const schedules = useSchedules();
  const scheduleTemplate = useScheduleTaskTemplate();
  const library = useTaskTemplates();
  const { maps, status: mapsStatus } = useMaps();
  const activeMapName = maps?.find((map) => map.active)?.name ?? null;

  /**
   * The map the editor is authoring for. `chosenMap` null means "follow the
   * loaded map", which is what nearly every job wants and what a fresh editor
   * starts on; a name is the operator's own choice (or the map of a template
   * they loaded) and survives until the editor is emptied. Kept as an override
   * rather than copied from the catalogue so a robot that switches maps
   * underneath an untouched editor follows it, while one the operator pointed
   * elsewhere stays pointed there.
   */
  const mapName = chosenMap ?? activeMapName;
  const editorMap = React.useMemo(
    () => maps?.find((map) => map.name === mapName) ?? null,
    [maps, mapName],
  );
  // The editor map's geometry, for the floor plan a MOVE row can open. Read
  // here rather than in each row so unfolding a row never refetches the
  // catalogue.
  const mapGrid = editorMap?.grid ?? null;
  const list = useMapVertexList(mapName);
  const vertices = list.vertices;
  // The catalogue's own state first: until it answers there is no name, and
  // "no-map" must mean there is nothing to author for, not that we have not
  // asked yet.
  const verticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : list.status;


  /**
   * Reset-by-remount for the two forms, bumped after a successful write. The same
   * trick the vertex panel uses to get a fresh field per draft, rather than
   * clearing state in an effect.
   */
  const [scheduleNonce, setScheduleNonce] = React.useState(0);
  const [saveNonce, setSaveNonce] = React.useState(0);

  const stepsOk = stepDraftsSubmittable(drafts.steps);
  const stepReason = !drafts.steps.length
    ? "Add at least one step."
    : !stepsOk
      ? // Not "coordinates": a SPEAK row fails this for an empty line, and each
        // row already says exactly what it is missing.
        "Some steps are incomplete — the marked rows say what is missing."
      : null;

  // Only the dispatch path needs a robot id — it is the prefix of the task id.
  // A schedule id is operator-authored, so the schedule path stays fully usable
  // on a robot that has not localized yet and has no state frame to read one from.
  const dispatchReason =
    stepReason ??
    (robotId
      ? null
      : "Waiting for the robot to report in. A job can be built now and run once it does.");

  /** Any MOVE step means the template has to name the map it is in. */
  const hasMoveStep = drafts.steps.some((step) => step.type === "MOVE");
  const draftMapName = hasMoveStep ? mapName : null;
  const saveReason =
    stepReason ??
    (draftMapName === null && hasMoveStep
      ? "Pick a map for this job\u2019s Move steps."
      : null);

  /**
   * The one thing a job for another map cannot do here is run. Its coordinates
   * are in that map's frame and would point somewhere else entirely in the
   * loaded one, so both the dispatch and the schedule pane are held — the
   * template schedule endpoint refuses this server-side too, but the loose-step
   * paths send raw coordinates with no map attached, and nothing on the robot
   * would notice. Saving is unaffected: that is what authoring for another map
   * is for.
   */
  const mapMismatch = draftMapName !== null && draftMapName !== activeMapName;
  const mismatchReason = mapMismatch
    ? `This job is for ${draftMapName}; the robot has ${activeMapName ?? "no map"} loaded, so it can be saved but not run from here.`
    : null;

  /**
   * Point the editor at another map. A waypoint already picked belongs to the
   * map it was picked on and means nothing on the new one, so those rows are
   * emptied — behind a confirm, because there is no undo, the same stance as
   * Stop editing.
   */
  const selectMap = (next: string) => {
    if (next === mapName) return;
    const picked = drafts.steps.filter(
      (step) => step.type === "MOVE" && step.vertexId !== null,
    );
    if (
      picked.length &&
      !window.confirm(
        `Switch to ${next}? The waypoint on ${picked.length} Move ${
          picked.length === 1 ? "step" : "steps"
        } will be cleared, since it belongs to ${mapName}.`,
      )
    ) {
      return;
    }
    for (const step of picked) {
      drafts.patch(step.key, {
        x: "",
        y: "",
        theta: "0",
        vertexId: null,
        vertexMissing: false,
      });
    }
    setChosenMap(next);
  };

  /**
   * Let go of the template *and* empty the editor, then go back to the
   * overview.
   *
   * It used to only detach the link and keep the steps, on the theory that
   * "load A, tweak, save as B" wanted them. But the button reads as "I am done
   * with this", and leaving a full step list behind meant the next thing the
   * operator did — dispatch, or Save as new — acted on rows they thought they
   * had put away. Emptying it is the reading the label already promises.
   *
   * Hence the confirm: there is no undo for a cleared list, and dirty tracking
   * is not available to make it conditional (see SaveGroup on why two explicit
   * buttons exist instead of a diff).
   */
  const stopEditing = () => {
    if (
      drafts.steps.length &&
      !window.confirm(
        `Stop editing "${editing?.name}"? The steps in the editor will be cleared.`,
      )
    ) {
      return;
    }
    // The whole draft at once: steps, template, map and name.
    clearDraft();
    router.push("/tasks");
  };

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/tasks"
            aria-label="Back to Tasks"
            className="instrument-label mb-2 inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-10"
          >
            <ArrowLeftIcon className="size-3.5" aria-hidden />
            Tasks
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {editing ? `Editing ${editing.name}` : "New task"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Steps run in order, one at a time, and if a step fails the rest are
            skipped.
          </p>
        </div>
        {editing && (
          <button
            type="button"
            // Frozen mid-run for the same reason the step list is: the tracked
            // statuses are keyed by position, so emptying the list under a
            // running task would leave them describing rows that are gone.
            disabled={dispatch.running}
            onClick={stopEditing}
            title="Let go of this template, clear the editor and go back to Tasks"
            className="instrument-label flex h-9 shrink-0 items-center gap-1 rounded-md border border-signal-cmd/40 bg-signal-cmd/8 px-2 text-signal-cmd transition-colors hover:bg-signal-cmd/16 disabled:opacity-40 pointer-coarse:h-10"
          >
            Stop editing
            <XIcon className="size-3 shrink-0" aria-hidden />
          </button>
        )}
      </header>

      {/* A run this tab is not following, whichever page started it. */}
      <ActiveRunBanner trackedTaskId={dispatch.taskId} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="overflow-hidden rounded-md border border-hairline bg-panel">
            <InstrumentGroup
              label="Steps"
              action={
                <div className="flex items-center gap-1.5">
                  <MapPicker
                    maps={maps}
                    value={mapName}
                    disabled={dispatch.running}
                    onPick={selectMap}
                  />
                  {/* The stop that is missing gets placed on the map, not here:
                   * this opens that map's editor in Waypoints mode, and its back
                   * button returns to this draft. A map with no floor plan has
                   * nothing to place on, so the link is a disabled span (the
                   * map card's Edit makes the same choice). */}
                  {mapName !== null && mapGrid !== null ? (
                    <Link
                      href={waypointEditorHref(mapName, { from: "tasks" })}
                      aria-label="Add waypoints on the floor plan"
                      title="Add waypoints on the floor plan"
                      className="flex size-6 items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
                    >
                      <MapPinPlusIcon className="size-3.5" aria-hidden />
                    </Link>
                  ) : (
                    <span
                      aria-hidden
                      className="flex size-6 items-center justify-center rounded-sm border border-hairline text-muted-foreground opacity-40"
                    >
                      <MapPinPlusIcon className="size-3.5" />
                    </span>
                  )}
                </div>
              }
              caption={mismatchReason ?? undefined}
            >
              <StepList
                steps={drafts.steps}
                vertices={vertices}
                verticesStatus={verticesStatus}
                mapName={mapName}
                mapGrid={mapGrid}
                disabled={dispatch.running}
                stepStates={dispatch.stepStates}
                onAdd={drafts.add}
                onPatch={drafts.patch}
                onRemove={drafts.remove}
                onMoveTo={drafts.moveTo}
              />
            </InstrumentGroup>
          </div>

          {/* Everything you do *with* the steps, in its own column. Sticky from lg
            * so a forty-step list scrolls past a Dispatch button that stays put —
            * the whole reason the one-column stack was uncomfortable. `top-4`
            * matches the page's own py-8 breathing room; the page scroller is the
            * containing block (see app/tasks/editor/page.tsx). */}
          <div className="overflow-hidden rounded-md border border-hairline bg-panel lg:sticky lg:top-4">
            <InstrumentGroup label="Save">
              <SaveGroup
                key={saveNonce}
                editing={editing}
                name={draftName}
                onNameChange={setDraftName}
                ready={stepsOk && saveReason === null}
                reason={saveReason}
                busy={library.busy}
                error={null}
                existingNames={library.templates.map((template) => template.name)}
                onCreate={(name) => {
                  void library
                    .create({
                      name,
                      map_name: draftMapName,
                      steps: toTemplateSteps(drafts.steps),
                    })
                    .then((created) => {
                      if (created) {
                        updateDraft((current) => ({
                          ...current,
                          editing: { id: created.id, name: created.name },
                          name: created.name,
                        }));
                        setSaveNonce((n) => n + 1);
                      }
                    });
                }}
                onUpdate={(id, name) => {
                  void library
                    .update(id, {
                      name,
                      map_name: draftMapName,
                      steps: toTemplateSteps(drafts.steps),
                    })
                    .then((updated) => {
                      if (updated) {
                        updateDraft((current) => ({
                          ...current,
                          editing: { id: updated.id, name: updated.name },
                          name: updated.name,
                        }));
                        setSaveNonce((n) => n + 1);
                      }
                    });
                }}
              />
            </InstrumentGroup>

            <InstrumentGroup label="When">
              {/* Locked while a task is in flight, and not for the reason the step
               * list is: Cancel lives in the dispatch pane, so letting the operator
               * switch to the schedule pane would hide the only stop button for a
               * robot that is currently moving. Mirroring Cancel into both panes was
               * the alternative and it is worse — two places that can stop a task. */}
              <Segmented
                label="When to run"
                stretch
                value={mode}
                options={MODE_OPTIONS}
                disabled={dispatch.running}
                onChange={setMode}
              />
            </InstrumentGroup>

            {mode === "now" ? (
              <InstrumentGroup
                label="Dispatch"
                // Static rather than a mapping over the backend's two 502 sentences
                // ("Start workflow failed" / "Failed to connect to Temporal server").
                // Both are terse and neither is actionable on its own, but substituting
                // friendlier prose would put backend copy in the frontend and go stale
                // the day the gateway's wording changes — `detail` is rendered verbatim
                // everywhere else in this console.
                caption="Jobs are queued by the robot's scheduler. A failure here means the job was never accepted, not that the robot refused it."
              >
                <DispatchPanel
                  dispatch={dispatch}
                  ready={stepsOk && robotId !== null && !mapMismatch}
                  reason={dispatchReason ?? mismatchReason}
                  onDispatch={() => void dispatch.send(toStepRequests(drafts.steps))}
                />
              </InstrumentGroup>
            ) : (
              <InstrumentGroup
                label="Schedule"
                caption={
                  editing
                    ? "Scheduling a saved job locks in today\u2019s waypoint positions. Moving a waypoint later will not change what the schedule runs."
                    : // Said before the fact, because it cannot be said after: a
                      // schedule registered from loose steps records no source,
                      // so no library row can ever show that it exists. Saving
                      // first is the whole difference, and it is one button away.
                      "These steps are not saved as a template, so this schedule will not show on any library row. Save it first if you want to see later that it runs on its own."
                }
              >
                <ScheduleForm
                  key={scheduleNonce}
                  existingIds={schedules.schedules.map((entry) => entry.id)}
                  ready={stepsOk && !mapMismatch}
                  reason={stepReason ?? mismatchReason}
                  busy={schedules.busy || library.busy || scheduleTemplate.isPending}
                  // The template path's refusal first: it is the newer of the
                  // two whenever it is set, because each path resets the other
                  // before it goes out.
                  error={scheduleTemplate.error?.message ?? schedules.error}
                  onCreate={(id, trigger) => {
                    // Two paths on purpose. With a template loaded, go through
                    // /task_templates/{id}/schedule: it re-resolves server-side,
                    // records the provenance in the schedule memo (so the row can
                    // later be told it has gone stale), and refuses an unattended run
                    // against another map or a deleted vertex. Without one, there is
                    // no row to reference and the plain schedule endpoint takes the
                    // steps. Both hooks re-read the list themselves on success.
                    if (editing) {
                      schedules.clearError();
                      scheduleTemplate.mutate(
                        { templateId: editing.id, scheduleId: id, trigger },
                        { onSuccess: () => setScheduleNonce((n) => n + 1) },
                      );
                      return;
                    }
                    scheduleTemplate.reset();
                    void schedules
                      .create({ id, trigger, steps: toStepRequests(drafts.steps) })
                      .then((created) => {
                        if (created) setScheduleNonce((n) => n + 1);
                      });
                  }}
                />
              </InstrumentGroup>
            )}
          </div>
        </div>
    </>
  );
}
