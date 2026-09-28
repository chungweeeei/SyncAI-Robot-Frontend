"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  MapPinPlusIcon,
  SaveIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";

import { InstrumentGroup } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { MapPicker } from "@/components/tasks/map-picker";
import { ScheduleForm } from "@/components/tasks/schedule-form";
import { StepList } from "@/components/tasks/step-list";
import { TaskNameField } from "@/components/tasks/task-name-field";
import { Button } from "@/components/ui/button";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useScheduleTaskTemplate, useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { waypointEditorHref } from "@/lib/map/links";
import type { TaskStepState } from "@/lib/api/task";
import type { TaskDraft } from "@/lib/task/draft-store";
import {
  stepDraftsSubmittable,
  toStepRequests,
  toTemplateSteps,
} from "@/lib/task/step";
import { taskTemplateNameOk } from "@/lib/task/template";

/**
 * The step list's per-row run readback, which this page no longer has: it
 * dispatches nothing, so no row here is ever executing. One shared empty map
 * rather than a fresh one per render.
 */
const NO_STEP_STATES: ReadonlyMap<string, TaskStepState> = new Map();

/**
 * The task editor, on a page of its own (/tasks/editor): the steps being
 * authored, their name, and the schedule they can be registered on. Save and
 * Go back sit in the header.
 *
 * **It does not run anything.** Run now used to be a pane here beside On a
 * schedule, with its own dispatch tracker; both it and the picker between
 * them were removed by request. A job runs from its row on /tasks, after it is
 * saved, which is also the one place its per-step readback is shown.
 *
 * **Its own route, off the overview.** The draft outlives a navigation
 * (lib/task/draft-store.ts), so the overview hands a template over by writing
 * it into the draft and pushing here — there is no id in the URL to keep in
 * step with it — and Go back leaves it there for next time.
 *
 * **Two columns.** The step list takes the wide column; the name and the
 * schedule ride in a narrower one that sticks to the top of the viewport while
 * the steps scroll. Below `lg` the grid is one column again.
 */
export function TaskEditor() {
  const router = useRouter();
  /**
   * Everything authored and not yet saved — the steps, the loaded template,
   * the map override and the name being typed — lives in the tab's task draft
   * rather than in this component's state, so leaving for the map editor to
   * place a missing stop and coming back finds the job as it was. The setters
   * below keep the call sites reading like state.
   */
  const [draft, updateDraft, clearDraft] = useTaskDraft();
  const { editing, chosenMap, name: draftName } = draft;
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
   * Reset-by-remount for the schedule form, bumped after a successful write.
   * The same trick the vertex panel uses to get a fresh field per draft,
   * rather than clearing state in an effect.
   */
  const [scheduleNonce, setScheduleNonce] = React.useState(0);

  const stepsOk = stepDraftsSubmittable(drafts.steps);
  const stepReason = !drafts.steps.length
    ? "Add at least one step."
    : !stepsOk
      ? // Not "coordinates": a SPEAK row fails this for an empty line, and each
        // row already says exactly what it is missing.
        "Some steps are incomplete — the marked rows say what is missing."
      : null;

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
   * loaded one, so the schedule pane is held — the
   * template schedule endpoint refuses this server-side too, but the loose-step
   * paths send raw coordinates with no map attached, and nothing on the robot
   * would notice. Saving is unaffected: that is what authoring for another map
   * is for.
   */
  const mapMismatch = draftMapName !== null && draftMapName !== activeMapName;
  const mismatchReason = mapMismatch
    ? `This job is for ${draftMapName}; the robot has ${activeMapName ?? "no map"} loaded, so it can be saved but not scheduled from here.`
    : null;

  /**
   * Point the editor at another map. A waypoint already picked belongs to the
   * map it was picked on and means nothing on the new one, so those rows are
   * emptied — behind a confirm, because there is no undo.
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
   * One Save: an update when a template is loaded, a new one otherwise. The
   * answer becomes the loaded template either way, so a second press updates
   * what the first created instead of making another copy.
   */
  const canSave =
    stepsOk && saveReason === null && taskTemplateNameOk(draftName) && !library.busy;
  const save = () => {
    if (!canSave) return;
    const body = {
      name: draftName.trim(),
      map_name: draftMapName,
      steps: toTemplateSteps(drafts.steps),
    };
    void (editing ? library.update(editing.id, body) : library.create(body)).then(
      (saved) => {
        if (!saved) return;
        updateDraft((current) => ({
          ...current,
          editing: { id: saved.id, name: saved.name },
          name: saved.name,
        }));
      },
    );
  };

  /**
   * Delete the loaded template, then leave: what is left in the editor would
   * be a draft of a job that no longer exists, and Save would quietly
   * re-create it under a new id. Behind a confirm, as on the library row —
   * there is no undo. Its schedules are named because they survive it: each
   * holds its own copy of the steps and keeps running until deleted itself.
   */
  const remove = () => {
    if (!editing) return;
    const linked = schedules.schedules.filter(
      (entry) => entry.task_template_id === editing.id,
    ).length;
    const survivors = linked
      ? ` ${linked === 1 ? "Its schedule keeps" : `Its ${linked} schedules keep`} running until deleted from Tasks.`
      : "";
    if (
      !window.confirm(
        `Delete task template "${editing.name}"? This cannot be undone.${survivors}`,
      )
    ) {
      return;
    }
    void library.remove(editing.id).then((gone) => {
      if (!gone) return;
      clearDraft();
      router.push("/tasks");
    });
  };

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* The job's own name, not "Editing …": being on this page already
              * says it is being edited. */}
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {editing ? editing.name : "New task"}
            </h1>
            {/* A placeholder: what the job's settings are is still to be
              * decided, so the button is on the page but does nothing yet.
              * Disabled rather than inert, so it does not look broken. */}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              aria-label="Job settings"
              title="Job settings"
              className="shrink-0 text-muted-foreground"
            >
              <SettingsIcon aria-hidden />
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Steps run in order, one at a time, and if a step fails the rest are
            skipped.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Leaves the draft as it is: unsaved steps are still there next
            * time, and Create task on /tasks is what asks before clearing
            * them. It used to be Stop editing, which emptied the editor. */}
          <Button
            variant="outline"
            onClick={() => router.push("/tasks")}
            className="pointer-coarse:min-h-10"
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            Go back
          </Button>
          <Button
            onClick={save}
            disabled={!canSave}
            // The reason is also under the name field; this is for the
            // operator whose eyes are on the button.
            title={saveReason ?? (taskTemplateNameOk(draftName) ? undefined : "Name the job to save it.")}
            className="pointer-coarse:min-h-10"
          >
            <SaveIcon data-icon="inline-start" aria-hidden />
            Save
          </Button>
          {editing && (
            <Button
              variant="destructive"
              onClick={remove}
              disabled={library.busy}
              className="pointer-coarse:min-h-10"
            >
              <Trash2Icon data-icon="inline-start" aria-hidden />
              Delete
            </Button>
          )}
        </div>
      </header>

      {/* A run this tab is not following, whichever page started it. */}
      <ActiveRunBanner trackedTaskId={null} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="overflow-hidden rounded-md border border-hairline bg-panel">
            <InstrumentGroup
              label="Steps"
              action={
                <div className="flex items-center gap-1.5">
                  <MapPicker
                    maps={maps}
                    value={mapName}
                    disabled={false}
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
                disabled={false}
                stepStates={NO_STEP_STATES}
                onAdd={drafts.add}
                onPatch={drafts.patch}
                onRemove={drafts.remove}
                onMoveTo={drafts.moveTo}
              />
            </InstrumentGroup>
          </div>

          {/* The name and the schedule, in their own column. Sticky from lg so
            * a forty-step list scrolls past a Create schedule button that stays
            * put. `top-4`
            * matches the page's own py-8 breathing room; the page scroller is the
            * containing block (see app/tasks/editor/page.tsx). */}
          <div className="overflow-hidden rounded-md border border-hairline bg-panel lg:sticky lg:top-4">
            <InstrumentGroup label="Name">
              <TaskNameField
                editing={editing}
                name={draftName}
                onNameChange={setDraftName}
                reason={saveReason}
                busy={library.busy}
                // The library's write error: a refused save or delete, in the
                // backend's own words.
                error={library.error}
                existingNames={library.templates.map((template) => template.name)}
                onSubmit={save}
              />
            </InstrumentGroup>

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
          </div>
        </div>
    </>
  );
}
