"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  MapPinPlusIcon,
  PlayIcon,
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
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { useSchedules } from "@/hooks/use-schedules";
import { useStepDrafts } from "@/hooks/use-step-drafts";
import { useTaskDispatch } from "@/hooks/use-task-dispatch";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { editorViews, waypointEditor } from "@/lib/map/links";
import { dispatchMapLock } from "@/lib/map/run-lock";
import { draftIsUnsaved, type TaskDraft } from "@/lib/task/draft-store";
import {
  isNavStep,
  stepDockVertices,
  stepDraftsSubmittable,
  stepIdFor,
  stepRoute,
  stepWaypointOrdinals,
  toDispatchSteps,
  toTemplateSteps,
} from "@/lib/task/step";
import { taskTemplateNameOk } from "@/lib/task/template";
import { cn } from "@/lib/utils";

/**
 * A 40 px finger target from sm up, a 32 px icon square below. `!` because the
 * button's inline-start padding is more specific than a width variant.
 */
const HEADER_BUTTON = "sm:pointer-coarse:min-h-10 max-sm:size-8 max-sm:px-0!";
/** Delete ends the editor's job, so the page behind it is put away. */
const LEAVING_OVERLAY = "bg-black/80";

/**
 * The task editor (/tasks/editor): the steps and the job's name, which is the
 * heading itself and saved with the steps.
 *
 * It runs only what it has just saved (Save & run), so an engineer tuning a
 * job on site edits, runs and edits again without leaving the page; a run
 * never goes out from an unsaved draft, so the history names a job that
 * exists. Schedules stay on /tasks, where the schedule list is. The overview
 * hands a template over through the draft (lib/task/draft-store.ts), so the
 * URL carries no id.
 */
export function TaskEditor({ robotId }: { robotId: string | null }) {
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
  const dispatch = useTaskDispatch(robotId);
  const { engaged: stopped } = useConsoleEstop();
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
   * Plan route needs something to tap on, a floor plan or a 3D map, and
   * stops to tap; without either it says why rather than opening onto nothing.
   */
  const [picking, setPicking] = React.useState(false);
  const pickViews = React.useMemo(() => (editorMap ? editorViews(editorMap) : []), [editorMap]);
  const pickProblem =
    pickViews.length === 0
      ? "This map has no floor plan or 3D map to pick waypoints on"
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

  /** The list is frozen while its run is followed: step ids are positional. */
  const running = dispatch.running;
  const canSave = stepsOk && saveReason === null && !library.busy && !running;

  /**
   * Why Save & run is held beyond Save's own reasons, the overview's Run
   * gates in the editor's words. A job for another map saves but does not run.
   */
  const runReason =
    saveReason ??
    (running
      ? "This job is running. Wait for it to end, or stop it from the top bar."
      : stopped
        ? "The emergency stop is engaged."
        : robotId === null
          ? "The robot has not reported in yet."
          : mapMismatch
            ? `Load ${draftMapName} on the robot to run this job.`
            : hasMoveStep
              ? dispatchMapLock(editorMap).reason
              : null);
  const canRun = canSave && runReason === null && !dispatch.busy;

  /** Every save answers with a card, since every save stays on the page. */
  const [savedNotice, setSavedNotice] = React.useState<SavedNoticeValue | null>(null);
  const dismissSaved = React.useCallback(() => setSavedNotice(null), []);
  /**
   * An update when a template is loaded, a create otherwise. Both stay: a
   * create becomes the loaded template, so a second press updates it rather
   * than making a copy, and the job can be run and tuned from here.
   */
  const save = (run = false) => {
    if (!canSave || (run && !canRun)) return;
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
        updateDraft((current) => ({
          ...current,
          editing: { id: saved.id, name: saved.name },
          name: saved.name,
        }));
        setSavedNotice({ name: saved.name, at: Date.now() });
        // The saved row, not the draft: its steps are what the history and a
        // later Run from /tasks will name.
        if (run) void dispatch.send(toDispatchSteps(saved.steps), saved.name, saved.map_name);
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
            onSubmit={() => save()}
          />
          {library.error && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {library.error}
            </p>
          )}
          {/* A refused run never started, so no row can say it. */}
          {(dispatch.refused ?? dispatch.error) && (
            <p role="alert" className="mt-1 text-[11px] leading-snug break-words text-signal-warn">
              {dispatch.refused ?? dispatch.error}
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
            variant="outline"
            onClick={() => save()}
            disabled={!canSave}
            title={saveReason ?? undefined}
            aria-label="Save"
            className={HEADER_BUTTON}
          >
            <SaveIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Save</span>
          </Button>
          <Button
            onClick={() => save(true)}
            disabled={!canRun}
            title={runReason ?? undefined}
            aria-label="Save and run"
            className={HEADER_BUTTON}
          >
            <PlayIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Save &amp; run</span>
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

      <SavedNotice notice={savedNotice} onDismiss={dismissSaved} />

      {/* A run this tab is not following, whichever page started it. */}
      <ActiveRunBanner trackedTaskId={dispatch.taskId} />

      <div className="overflow-hidden rounded-md border border-hairline bg-panel">
        <InstrumentGroup
          label="Steps"
          action={
            <div className="flex items-center gap-1.5">
              <MapPicker
                maps={maps}
                value={mapName}
                disabled={running}
                onPick={selectMap}
              />
              {/* Words beside the icon from sm up: a bare route glyph did not
                * say that the map takes taps. */}
              <button
                type="button"
                aria-pressed={pickOpen}
                aria-label="Plan route"
                title={pickProblem ?? "Tap waypoints on the map to add steps in order"}
                disabled={pickProblem !== null || running}
                onClick={() => setPicking((open) => !open)}
                className={cn(
                  "instrument-label flex h-6 items-center gap-1 rounded-sm border px-1.5 transition-colors disabled:opacity-40 disabled:hover:bg-transparent max-sm:w-6 max-sm:justify-center max-sm:px-0",
                  pickOpen
                    ? "border-signal-cmd/40 bg-signal-cmd/8 text-signal-cmd hover:bg-signal-cmd/16"
                    : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
                )}
              >
                <RouteIcon className="size-3.5" aria-hidden />
                <span className="max-sm:hidden">Plan route</span>
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
          {pickOpen && mapName !== null && (
            <RoutePicker
              // A new map starts on its own first view and floor.
              key={mapName}
              mapName={mapName}
              mapGrid={mapGrid}
              views={pickViews}
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
            disabled={running}
            stepStates={dispatch.stepStates}
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
