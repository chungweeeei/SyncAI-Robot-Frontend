"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckIcon,
  MapPinPlusIcon,
  RouteIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip, InstrumentGroup } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { MapPicker } from "@/components/tasks/map-picker";
import { RoutePicker } from "@/components/tasks/route-picker";
import { SavedNotice, type SavedNoticeValue } from "@/components/tasks/saved-notice";
import { StepList } from "@/components/tasks/step-list";
import { TaskTitle } from "@/components/tasks/task-title";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { waypointEditor } from "@/lib/map/links";
import type { TaskStepState } from "@/lib/api/task";
import { draftIsUnsaved, type TaskDraft } from "@/lib/task/draft-store";
import {
  isNavStep,
  stepDockVertices,
  stepDraftsSubmittable,
  stepIdFor,
  stepRoute,
  stepWaypointOrdinals,
  toTemplateSteps,
} from "@/lib/task/step";
import { taskTemplateNameOk } from "@/lib/task/template";
import { cn } from "@/lib/utils";

/** This page dispatches nothing, so no row has run state. Shared, not per render. */
const NO_STEP_STATES: ReadonlyMap<string, TaskStepState> = new Map();

/**
 * A 40 px finger target from sm up, a 32 px icon square below. `!` because the
 * button's inline-start padding is more specific than a width variant.
 */
const HEADER_BUTTON = "sm:pointer-coarse:min-h-10 max-sm:size-8 max-sm:px-0!";
/** Both dialogs end the editor's job, so the page behind them is put away. */
const LEAVING_OVERLAY = "bg-black/80";

/**
 * The task editor (/tasks/editor): the steps and the job's name, which is the
 * heading itself and saved with the steps.
 *
 * It does not run or schedule anything: a job does both from its row on
 * /tasks, so only a saved job can be scheduled. The overview hands a template
 * over through the draft (lib/task/draft-store.ts), so the URL carries no id.
 */
export function TaskEditor() {
  const router = useRouter();
  /**
   * Everything unsaved lives in the tab's draft, not component state, so a
   * trip to the map editor to place a missing stop finds the job as it was.
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
   * Navigating keeps the draft, so only closing the tab (and a reload, which
   * the browser cannot tell apart) is asked about, and only with work to lose.
   */
  const unsaved = draftIsUnsaved(draft, library.templates);
  useLeaveGuard(unsaved);

  /**
   * `chosenMap` null follows the loaded map; a name is the operator's (or a
   * loaded template's) choice. An override rather than a copy, so an untouched
   * editor follows a map switch and a pointed one stays put.
   */
  const mapName = chosenMap ?? activeMapName;
  const editorMap = React.useMemo(
    () => maps?.find((map) => map.name === mapName) ?? null,
    [maps, mapName],
  );
  // Read here, not per row, so unfolding a row never refetches the catalogue.
  const mapGrid = editorMap?.grid ?? null;
  /** Where this map's waypoints are placed: its floor plan, else its 3D map. */
  const waypointLink = React.useMemo(
    () => (editorMap ? waypointEditor(editorMap, { from: "tasks" }) : null),
    [editorMap],
  );
  const list = useMapVertexList(mapName);
  const vertices = list.vertices;
  // The catalogue's state first, so "no-map" never means "not asked yet".
  const verticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : list.status;

  /** The whole route, so each row's floor plan reads the same. */
  const stepMarks = React.useMemo(() => stepWaypointOrdinals(drafts.steps), [drafts.steps]);
  const dockMarks = React.useMemo(() => stepDockVertices(drafts.steps), [drafts.steps]);
  const route = React.useMemo(() => stepRoute(drafts.steps), [drafts.steps]);

  /**
   * Pick on map needs a floor plan to tap and stops to tap on; without either
   * it says why rather than opening onto nothing. A 3D-only map still has the
   * Add row and the dropdown.
   */
  const [picking, setPicking] = React.useState(false);
  const pickProblem =
    mapGrid === null
      ? "This map has no floor plan to pick waypoints on"
      : verticesStatus !== "ok" || vertices.length === 0
        ? "This map has no waypoints to pick yet"
        : null;
  const pickOpen = picking && pickProblem === null;
  const stepKeys = React.useMemo(
    () => new Set(drafts.steps.map((step) => step.key)),
    [drafts.steps],
  );

  /**
   * Set when Save is pressed without a usable name, so Save points at the
   * field instead of being a dead button. Typing clears it.
   */
  const [nameMissing, setNameMissing] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);
  const setName = (name: string) => {
    setNameMissing(false);
    updateDraft((current) => ({ ...current, name }));
  };

  const stepsOk = stepDraftsSubmittable(drafts.steps);
  const stepReason = !drafts.steps.length
    ? "Add at least one step."
    : !stepsOk
      ? // Generic: each row already says what it is missing.
        "Some steps are incomplete — the marked rows say what is missing."
      : null;

  /** Any waypoint step (Move or Dock) means the template has to name the map it is in. */
  const hasMoveStep = drafts.steps.some(isNavStep);
  const draftMapName = hasMoveStep ? mapName : null;
  const saveReason =
    stepReason ??
    (draftMapName === null && hasMoveStep
      ? "Pick a map for this job\u2019s waypoints."
      : null);

  /** A job for another map saves but cannot run: its coordinates are in that map's frame. */
  const mapMismatch = draftMapName !== null && draftMapName !== activeMapName;
  const mismatchReason = mapMismatch
    ? `This job is for ${draftMapName}; the robot has ${activeMapName ?? "no map"} loaded, so it can be saved but not run or scheduled until that map is loaded.`
    : null;

  /** Picked waypoints mean nothing on another map, so they are cleared, behind a confirm. */
  const selectMap = (next: string) => {
    if (next === mapName) return;
    const picked = drafts.steps.filter((step) => isNavStep(step) && step.vertexId !== null);
    if (
      picked.length &&
      !window.confirm(
        `Switch to ${next}? The waypoint on ${picked.length} ${
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
        z: 0,
        vertexId: null,
        vertexMissing: false,
      });
    }
    setChosenMap(next);
  };

  /**
   * Which row each step id of the last save was sent from. The ids are
   * positional (stepIdFor), so a refusal is read against the list as sent,
   * not as it is after a row has moved.
   */
  const [sentKeys, setSentKeys] = React.useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  const refusedKey = library.refusedStepId ? sentKeys.get(library.refusedStepId) : undefined;
  const refusal =
    refusedKey !== undefined && library.error ? { key: refusedKey, message: library.error } : null;

  const canSave = stepsOk && saveReason === null && !library.busy;
  /** An update answers with a card, since it stays on the page. */
  const [savedNotice, setSavedNotice] = React.useState<SavedNoticeValue | null>(null);
  const dismissSaved = React.useCallback(() => setSavedNotice(null), []);
  /**
   * A create answers with a dialog instead, because it leaves: a page that
   * changed under the operator without a word read as a Save that lost the
   * job. The draft is only emptied on the way out, or the editor behind the
   * dialog would blank while it is still being read.
   */
  const [createdName, setCreatedName] = React.useState<string | null>(null);
  const leaveCreated = () => {
    setCreatedName(null);
    clearDraft();
    router.push("/tasks");
  };
  /**
   * An update when a template is loaded, a create otherwise. A create empties
   * the draft (it now duplicates a saved row) and leaves for /tasks, where the
   * job runs; an update stays put so a second press does not make a copy.
   */
  const save = () => {
    if (!canSave) return;
    setSavedNotice(null);
    if (!taskTemplateNameOk(draftName)) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    const body = {
      name: draftName.trim(),
      map_name: draftMapName,
      steps: toTemplateSteps(drafts.steps),
    };
    setSentKeys(new Map(drafts.steps.map((step, index) => [stepIdFor(index, step.type), step.key])));
    void (editing ? library.update(editing.id, body) : library.create(body)).then(
      (saved) => {
        if (!saved) return;
        if (!editing) {
          setCreatedName(saved.name);
          return;
        }
        updateDraft((current) => ({
          ...current,
          editing: { id: saved.id, name: saved.name },
          name: saved.name,
        }));
        setSavedNotice({ name: saved.name, at: Date.now() });
      },
    );
  };

  /**
   * Delete, then leave, or Save would quietly re-create the job under a new id.
   * Confirmed in an AlertDialog (no backdrop dismiss) because the button sits
   * beside Save and nothing brings the job back. The dialog names its
   * schedules because they survive: each holds its own copy of the steps.
   */
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const linkedSchedules = editing
    ? schedules.schedules.filter((entry) => entry.task_template_id === editing.id).length
    : 0;
  const closeDelete = () => {
    setConfirmingDelete(false);
    library.clearError();
  };
  const remove = () => {
    if (!editing || library.busy) return;
    void library.remove(editing.id).then((gone) => {
      // A refusal keeps the dialog open, with the backend's sentence in it.
      if (!gone) return;
      setConfirmingDelete(false);
      clearDraft();
      router.push("/tasks");
    });
  };

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TaskTitle
            ref={nameRef}
            value={draftName}
            savedName={editing?.name ?? null}
            busy={library.busy}
            missing={nameMissing}
            existingNames={library.templates.map((template) => template.name)}
            onChange={setName}
            onRevert={() => setName(editing?.name ?? "")}
            onSubmit={save}
          />
          {library.error && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {library.error}
            </p>
          )}
          {/* The draft survives leaving, so the page has to say it is unsaved.
            * Held back until the library answers for a loaded job, or it
            * would flash on every open. */}
          {unsaved && (draft.editing === null || library.status === "ok") && (
            <Chip tone="caution" className="mt-1">
              Unsaved changes
            </Chip>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            Steps run in order. Boxed steps start together, and the next step
            waits for all of them. If a step fails, the rest are skipped.
          </p>
        </div>
        {/* Icons only below sm: with words they squeezed the heading to one
          * letter on a phone. */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Keeps the draft; Create task on /tasks asks before clearing it. */}
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
            onClick={save}
            disabled={!canSave}
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
              onClick={() => {
                library.clearError();
                setConfirmingDelete(true);
              }}
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

      <AlertDialog
        open={confirmingDelete && editing !== null}
        onOpenChange={(open) => {
          if (!open && !library.busy) closeDelete();
        }}
      >
        <AlertDialogContent overlayClassName={LEAVING_OVERLAY}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {editing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
              {linkedSchedules > 0 &&
                ` ${linkedSchedules === 1 ? "Its schedule keeps" : `Its ${linkedSchedules} schedules keep`} running until deleted from Tasks.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {library.error && (
            <p role="alert" className="text-[11px] leading-tight text-signal-warn">
              {library.error}
            </p>
          )}

          <AlertDialogFooter>
            <Button variant="ghost" size="sm" disabled={library.busy} onClick={closeDelete}>
              <ArrowLeftIcon data-icon="inline-start" />
              Keep
            </Button>
            <Button variant="destructive" size="sm" disabled={library.busy} onClick={remove}>
              <Trash2Icon data-icon="inline-start" />
              {library.busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Any way out of it leaves: the job is saved either way, and staying
        * on an editor that no longer holds it would invite a second copy. */}
      <AlertDialog
        open={createdName !== null}
        onOpenChange={(open) => {
          if (!open) leaveCreated();
        }}
      >
        <AlertDialogContent overlayClassName={LEAVING_OVERLAY}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckIcon className="size-4 shrink-0 text-signal-live" aria-hidden />
              <span className="min-w-0 break-words">Saved {createdName}</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              It is in the task list on Tasks, ready to run or schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button size="sm" autoFocus onClick={leaveCreated}>
              Go to Tasks
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SavedNotice notice={savedNotice} onDismiss={dismissSaved} />

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
              {/* Words beside the icon from sm up: a bare route glyph did not
                * say that the map takes taps. */}
              <button
                type="button"
                aria-pressed={pickOpen}
                aria-label="Pick on map"
                title={pickProblem ?? "Tap waypoints on the floor plan to add steps in order"}
                disabled={pickProblem !== null}
                onClick={() => setPicking((open) => !open)}
                className={cn(
                  "instrument-label flex h-6 items-center gap-1 rounded-sm border px-1.5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent max-sm:w-6 max-sm:justify-center max-sm:px-0",
                  pickOpen
                    ? "border-signal-cmd/40 bg-signal-cmd/8 text-signal-cmd hover:bg-signal-cmd/16"
                    : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
                )}
              >
                <RouteIcon className="size-3.5" aria-hidden />
                <span className="max-sm:hidden">Pick on map</span>
              </button>
              {/* Opens the map's floor plan editor in Waypoints mode, or its
               * 3D map with Waypoint armed; its back button returns here.
               * Neither means nothing to place on, so a disabled span. */}
              {waypointLink !== null ? (
                <Link
                  href={waypointLink.href}
                  aria-label={`Add waypoints on the ${waypointLink.surface}`}
                  title={`Add waypoints on the ${waypointLink.surface}`}
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
          {pickOpen && mapName !== null && mapGrid !== null && (
            <RoutePicker
              mapName={mapName}
              mapGrid={mapGrid}
              vertices={vertices}
              stepMarks={stepMarks}
              dockMarks={dockMarks}
              route={route}
              stepCount={drafts.steps.length}
              onPick={drafts.addFromVertex}
              onUndo={drafts.remove}
              hasStep={(key) => stepKeys.has(key)}
              onDone={() => setPicking(false)}
            />
          )}
          <StepList
            steps={drafts.steps}
            vertices={vertices}
            verticesStatus={verticesStatus}
            mapName={mapName}
            mapGrid={mapGrid}
            waypointLink={waypointLink}
            stepMarks={stepMarks}
            dockMarks={dockMarks}
            route={route}
            disabled={false}
            stepStates={NO_STEP_STATES}
            onAdd={drafts.add}
            onPatch={drafts.patch}
            onRemove={drafts.remove}
            onMoveTo={drafts.moveTo}
            onUngroup={drafts.ungroup}
            refusal={refusal}
          />
        </InstrumentGroup>
      </div>
    </>
  );
}
