"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MapPinPlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";

import { Chip, InstrumentGroup, Segmented } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { DispatchPanel } from "@/components/tasks/dispatch-panel";
import { MapPicker } from "@/components/tasks/map-picker";
import { SaveGroup } from "@/components/tasks/save-group";
import { ScheduleForm } from "@/components/tasks/schedule-form";
import { ScheduleList } from "@/components/tasks/schedule-list";
import { StepList } from "@/components/tasks/step-list";
import { TaskLibrary } from "@/components/tasks/task-library";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useScheduleTaskTemplate, useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useTaskDraft } from "@/hooks/use-task-draft";
import type { TaskTemplate } from "@/lib/api/task-template";
import { waypointEditorHref } from "@/lib/map/links";
import type { TaskDraft, TaskEditorMode } from "@/lib/task/draft-store";
import {
  fromTemplateSteps,
  stepDraftsSubmittable,
  toDispatchSteps,
  toTemplateSteps,
  toStepRequests,
} from "@/lib/task/step";

type TaskMode = TaskEditorMode;

const MODE_OPTIONS = [
  { value: "now", label: "Run now" },
  { value: "schedule", label: "On a schedule" },
] as const satisfies readonly { value: TaskMode; label: string }[];

/**
 * The task console: a library of task templates, a composer, and the two ways to
 * run what is in the composer.
 *
 * **The library is first, above the composer.** The complaint this answers is that
 * returning to the page showed nothing saved, so the first thing under the header
 * has to answer "what do I have". Putting it last would leave an operator who
 * saved a route yesterday landing on an empty step list again — the same
 * complaint, one scroll further down.
 *
 * **One route, one mount, one tracker.** Splitting into /tasks + /tasks/[id] was
 * rejected: the App Router unmounts on navigation, so walking back to an index
 * while a task ran would lose the tracked id and with it the per-step readback
 * for a moving robot. Cancel is no longer part of that argument — ActiveRunBanner
 * recovers any run from GET /api/v1/active_tasks, so a task that outlived its
 * tracker can still be stopped from here — but the step-level detail is still
 * only available to the mount that dispatched it.
 *
 * **The task editor is two columns and folds away.** Stacking steps, name, mode and
 * dispatch in one column meant the button that runs the thing was a scroll below
 * the thing — and on a page whose first job is "what do I have", a composer that
 * is always open pushes the library up and off the screen. So: the step list
 * takes the wide column, everything you *do* with it (name it, choose when, go)
 * rides in a narrower one that sticks to the top of the viewport while the steps
 * scroll, and the whole section collapses to a single bar when nothing is being
 * authored. Below `lg` the grid is one column again and the reading order falls
 * back to the sentence being composed: these steps → when → go.
 *
 * Switching modes still never touches what was authored — the step list is
 * outside both panes.
 */
export function TaskConsole({ robotId }: { robotId: string | null }) {
  /**
   * Everything authored and not yet saved — the steps, the loaded template,
   * the map override, the composer's fold and the name being typed — lives in
   * the tab's task draft rather than in this component's state, so leaving
   * for the map editor to place a missing stop and coming back finds the job
   * as it was. The setters below keep the call sites reading like state.
   */
  const [draft, updateDraft, clearDraft] = useTaskDraft();
  const { mode, editing, chosenMap, composerOpen, name: draftName } = draft;
  const setMode = React.useCallback(
    (mode: TaskMode) => updateDraft((current) => ({ ...current, mode })),
    [updateDraft],
  );
  const setEditing = React.useCallback(
    (editing: TaskDraft["editing"]) => updateDraft((current) => ({ ...current, editing })),
    [updateDraft],
  );
  const setChosenMap = React.useCallback(
    (chosenMap: string | null) => updateDraft((current) => ({ ...current, chosenMap })),
    [updateDraft],
  );
  const setComposerOpen = React.useCallback(
    (open: boolean | ((current: boolean) => boolean)) =>
      updateDraft((current) => ({
        ...current,
        composerOpen: typeof open === "function" ? open(current.composerOpen) : open,
      })),
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

  // `editing` (in the draft) is the template loaded in the composer, so Save
  // can offer to overwrite it; null when the operator is authoring something
  // new.

  /**
   * Which template the in-flight run came from; null when it came from the
   * composer. Only used to decide which library row shows the readback, so the
   * two degenerate cases (row deleted mid-run, row not in the current scope)
   * resolve to "no badge" rather than to a lost run.
   */
  const [dispatchedFrom, setDispatchedFrom] = React.useState<string | null>(null);

  /**
   * Reset-by-remount for the two forms, bumped after a successful write. The same
   * trick the vertex panel uses to get a fresh field per draft, rather than
   * clearing state in an effect.
   */
  const [scheduleNonce, setScheduleNonce] = React.useState(0);
  const [saveNonce, setSaveNonce] = React.useState(0);

  /**
   * `composerOpen` (in the draft) is whether the composer is unfolded. Starts
   * closed: a fresh mount has an empty step list, and an empty composer is
   * three panels of chrome standing between the operator and the library they
   * came to read.
   *
   * It is forced open while a task is in flight, because Cancel lives in
   * DispatchPanel — the same one-stop-button rule the mode picker's `disabled`
   * and `dispatchSaved` already follow. A collapsed composer over a moving robot
   * would hide the only way to stop it.
   */
  const editorOpen = composerOpen || dispatch.running;

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
   * Let go of the template *and* empty the editor, then fold it away.
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
    // The whole draft at once: steps, template, map, name and the fold.
    clearDraft();
    // Remount SaveGroup so nothing local outlives the task just let go of.
    setSaveNonce((n) => n + 1);
  };

  const loadTemplate = (template: TaskTemplate) => {
    // fromTemplateSteps reads resolved_params, so a vertex moved since the save
    // shows its *current* pose here — which is the whole point of storing the
    // reference.
    drafts.replace(fromTemplateSteps(template.steps));
    // A template for another map opens on that map: its waypoints, floor plan
    // and the saved map_name all follow. One with no MOVE step names none and
    // leaves the choice alone.
    // One draft update for the rest, so no frame shows the new steps under
    // the old name. Loading a template *is* the start of editing it, so the
    // composer unfolds whether or not the operator opened it — otherwise the
    // pencil button would look like it did nothing.
    updateDraft((current) => ({
      ...current,
      chosenMap: template.map_name ?? current.chosenMap,
      editing: { id: template.id, name: template.name },
      name: template.name,
      composerOpen: true,
    }));
    setSaveNonce((n) => n + 1);
  };

  const dispatchTemplate = (template: TaskTemplate) => {
    // Force the composer back to Dispatch mode before firing. Cancel lives in
    // DispatchPanel and the mode picker freezes for the duration of a run, so
    // starting a task from a library row while the Schedule pane was open would
    // leave a moving robot with no stop button anywhere on screen. The mirror of
    // the one-stop-button rule the Segmented's own comment records.
    setMode("now");
    setDispatchedFrom(template.id);
    // Latched open, not merely forced open for the duration: `editorOpen` would
    // already unfold the composer while the task runs, but folding it shut again
    // the moment the run ends would take the terminal status and its Clear
    // button with it — from a run the operator started two clicks ago.
    setComposerOpen(true);
    // Deliberately does NOT load the template into the composer: that would
    // silently discard whatever the operator was authoring, which is the same
    // class of data loss this feature exists to fix.
    void dispatch.send(toDispatchSteps(template.steps));
  };

  return (
    <>
      {/* Above the library, because it is the most urgent thing this screen can
        * say: a robot is executing something and this tab is not the one that
        * asked for it. */}
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
          caption="A saved Move step follows the waypoint it was taken from, so moving a waypoint on the map updates every job that uses it."
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
            onLoad={loadTemplate}
            onSchedule={(template) => {
              // The trigger is authored in the composer's Schedule pane, which is
              // the only place a timed/interval form exists. Loading the template
              // first is what makes that pane describe the thing being scheduled.
              loadTemplate(template);
              setMode("schedule");
            }}
            onDelete={(template) => {
              // A confirm rather than an undo: there is no local history to step
              // back over. Same stance as the vertex panel and the schedule list.
              if (
                window.confirm(
                  `Delete task template "${template.name}"? This cannot be undone.`,
                )
              ) {
                void library.remove(template.id).then((gone) => {
                  if (gone && editing?.id === template.id) setEditing(null);
                });
              }
            }}
          />
        </InstrumentGroup>
      </div>

      {/* Its own frame, because the registered schedules are a different object
       * from the one being authored — not another group inside the composer.
       *
       * Above the editor, beside the library, because it answers the same
       * question: "what does this robot already have". It used to be the last
       * thing on the page, under a composer that can run to forty steps, so the
       * one list of what runs unattended was a scroll past the thing being
       * built — and the first thing an operator asks on returning is what is
       * already set to run, not what they were drafting.
       *
       * Shown whenever any exist, not only in Schedule mode. Gating it on the
       * mode meant the one place that lists what this robot does unattended was
       * behind a picker inside a folded-away editor: an operator on the Dispatch
       * pane could not see that anything was registered at all. */}
      {(mode === "schedule" || schedules.schedules.length > 0) && (
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
      )}

      {/* The editor's own header, outside both columns: it is the handle for the
        * whole section, and a chevron sitting in one column's group header would
        * fold the other column from a control that does not belong to it.
        *
        * "Task editor" on screen, "composer" in this file's prose and state
        * names — the operator's word for the thing is the one that goes in the
        * label, the same split the REST vocabulary makes between "vertex" and
        * the `MapPoint` it is stored as. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={editorOpen}
          disabled={dispatch.running}
          onClick={() => setComposerOpen((v) => !v)}
          title={
            dispatch.running
              ? "A job is running — Cancel is in the panel below."
              : editorOpen
                ? "Fold the editor away"
                : "Build or edit a task"
          }
          className="instrument-label flex min-w-0 flex-1 items-center gap-2 rounded-md border border-hairline bg-panel px-3 py-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-100 disabled:hover:bg-panel"
        >
          {editorOpen ? (
            <ChevronDownIcon className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="shrink-0">Task editor</span>
          {/* Collapsed, this line is the only thing saying what is in there. */}
          <span className="readout min-w-0 flex-1 truncate text-left text-[11px] normal-case">
            {editing
              ? `Editing ${editing.name}`
              : drafts.steps.length
                ? "Unsaved steps"
                : "Empty"}
          </span>
          <Chip tone={drafts.steps.length ? "neutral" : "caution"}>
            {drafts.steps.length}
          </Chip>
        </button>
        {editing && (
          <button
            type="button"
            // Frozen mid-run for the same reason the step list is: the tracked
            // statuses are keyed by position, so emptying the list under a
            // running task would leave them describing rows that are gone.
            disabled={dispatch.running}
            onClick={stopEditing}
            title="Let go of this template, clear the editor and fold it away"
            className="instrument-label flex h-9 min-w-0 shrink items-center gap-1 rounded-md border border-signal-cmd/40 bg-signal-cmd/8 px-2 text-signal-cmd transition-colors hover:bg-signal-cmd/16 disabled:opacity-40"
          >
            <span className="min-w-0 truncate">Stop editing</span>
            <XIcon className="size-3 shrink-0" aria-hidden />
          </button>
        )}
      </div>

      {editorOpen && (
        <div className="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
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
            * containing block (see app/tasks/page.tsx). */}
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
                  onDispatch={() => {
                    // Dispatching from the composer, so no library row owns this run.
                    setDispatchedFrom(null);
                    void dispatch.send(toStepRequests(drafts.steps));
                  }}
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
      )}
    </>
  );
}
