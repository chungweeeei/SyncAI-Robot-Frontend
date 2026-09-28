"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, MapPinPlusIcon, SaveIcon, Trash2Icon } from "lucide-react";

import { InstrumentGroup } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { MapPicker } from "@/components/tasks/map-picker";
import { StepList } from "@/components/tasks/step-list";
import { TaskTitle } from "@/components/tasks/task-title";
import { Button } from "@/components/ui/button";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { waypointEditorHref } from "@/lib/map/links";
import type { TaskStepState } from "@/lib/api/task";
import type { TaskDraft } from "@/lib/task/draft-store";
import { stepDraftsSubmittable, toTemplateSteps } from "@/lib/task/step";
import { taskTemplateNameOk } from "@/lib/task/template";

/**
 * The step list's per-row run readback, which this page no longer has: it
 * dispatches nothing, so no row here is ever executing. One shared empty map
 * rather than a fresh one per render.
 */
const NO_STEP_STATES: ReadonlyMap<string, TaskStepState> = new Map();

/**
 * The header's three buttons: a 40 px target under a finger from sm up, and
 * a 32 px icon square below it (see the header). `!` because the button's own
 * inline-start padding is a more specific rule than a width variant.
 */
const HEADER_BUTTON = "sm:pointer-coarse:min-h-10 max-sm:size-8 max-sm:px-0!";

/**
 * The task editor, on a page of its own (/tasks/editor): the steps being
 * authored and the job's name. Go back, Save and Delete sit in the header, and
 * the name is the heading itself, edited in place (TaskTitle).
 *
 * **It does not run or schedule anything.** Both used to be panes here. A job
 * runs from its row on /tasks and is scheduled there too, where the schedule
 * list it joins already is — and only a saved job can be, which retires the
 * old trap of scheduling loose steps that no row could ever show.
 *
 * **Its own route, off the overview.** The draft outlives a navigation
 * (lib/task/draft-store.ts), so the overview hands a template over by writing
 * it into the draft and pushing here — there is no id in the URL to keep in
 * step with it — and Go back leaves it there for next time.
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
  const setSteps = React.useCallback(
    (change: (current: TaskDraft["steps"]) => TaskDraft["steps"]) =>
      updateDraft((current) => ({ ...current, steps: change(current.steps) })),
    [updateDraft],
  );
  const drafts = useStepDrafts(draft.steps, setSteps);
  const schedules = useSchedules();
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
   * Whether the heading is the name field, and whether confirming it should
   * go on to save — true when Save was pressed on a job with no name yet, so
   * naming it is one step of saving rather than a detour before it.
   *
   * The heading is keyed by a count bumped on each *opening*, so every
   * opening starts from the current name. Only opening: a key that changed on
   * closing too would remount the heading as it closed, and it would lose the
   * focus it hands back to the Rename button.
   */
  const [naming, setNaming] = React.useState<{ thenSave: boolean } | null>(null);
  const [namingKey, setNamingKey] = React.useState(0);
  const openNaming = (thenSave: boolean) => {
    setNamingKey((key) => key + 1);
    setNaming({ thenSave });
  };

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
   * A job for another map can be saved but not run or scheduled: its
   * coordinates are in that map's frame. Those two buttons live on its row
   * on /tasks, which holds them; this only says so where the job is built.
   */
  const mapMismatch = draftMapName !== null && draftMapName !== activeMapName;
  const mismatchReason = mapMismatch
    ? `This job is for ${draftMapName}; the robot has ${activeMapName ?? "no map"} loaded, so it can be saved but not run or scheduled until that map is loaded.`
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
   * what the first created instead of making another copy. A job with no
   * name yet opens the heading to be named, and confirming it saves.
   */
  const canSave = stepsOk && saveReason === null && !library.busy;
  const save = (name: string = draftName) => {
    if (!canSave) return;
    if (!taskTemplateNameOk(name)) {
      openNaming(true);
      return;
    }
    const body = {
      name: name.trim(),
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
   * Confirming the heading. A saved job is renamed at once and by name alone
   * — the PUT is partial, so step edits not yet saved stay unsaved, which is
   * what a rename should leave alone. A new job only takes the name into the
   * draft, unless Save is what asked for it.
   */
  const confirmName = (name: string) => {
    const thenSave = naming?.thenSave ?? false;
    if (editing && !thenSave) {
      void library.update(editing.id, { name }).then((renamed) => {
        if (!renamed) return;
        setNaming(null);
        updateDraft((current) => ({
          ...current,
          editing: { id: renamed.id, name: renamed.name },
          name: renamed.name,
        }));
      });
      return;
    }
    setNaming(null);
    updateDraft((current) => ({ ...current, name }));
    if (thenSave) save(name);
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
        <div className="min-w-0 flex-1">
          <TaskTitle
            key={namingKey}
            // The job's own name, not "Editing …": being on this page
            // already says it is being edited.
            title={editing?.name ?? (draftName.trim() || "New task")}
            name={draftName}
            naming={naming !== null}
            busy={library.busy}
            existingNames={library.templates.map((template) => template.name)}
            onStartNaming={() => openNaming(false)}
            onCancel={() => setNaming(null)}
            onSubmit={confirmName}
          />
          {/* The library's write error — a refused save, rename or delete —
            * in the backend's own words, under the name it was about. */}
          {library.error && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {library.error}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Steps run in order, one at a time, and if a step fails the rest are
            skipped.
          </p>
        </div>
        {/* Below sm the three are icons alone, 32 px square, by request: with
          * their words they took most of a phone's width and squeezed the
          * heading to one letter. Their names stay as aria-labels, and the
          * words come back from sm up, where there is room for both. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Leaves the draft as it is: unsaved steps are still there next
            * time, and Create task on /tasks is what asks before clearing
            * them. It used to be Stop editing, which emptied the editor. */}
          <Button
            variant="outline"
            onClick={() => router.push("/tasks")}
            aria-label="Go back"
            className={HEADER_BUTTON}
          >
            <ArrowLeftIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Go back</span>
          </Button>
          <Button
            onClick={() => save()}
            disabled={!canSave}
            // The step list says which rows are unfinished; this is for the
            // operator whose eyes are on the button.
            title={saveReason ?? undefined}
            aria-label="Save"
            className={HEADER_BUTTON}
          >
            <SaveIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Save</span>
          </Button>
          {editing && (
            <Button
              variant="destructive"
              onClick={remove}
              disabled={library.busy}
              aria-label="Delete"
              className={HEADER_BUTTON}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden />
              <span className="max-sm:hidden">Delete</span>
            </Button>
          )}
        </div>
      </header>

      {/* A run this tab is not following, whichever page started it. */}
      <ActiveRunBanner trackedTaskId={null} />

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
          caption={saveReason ?? mismatchReason ?? undefined}
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
    </>
  );
}
