"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftIcon,
  CopyIcon,
  EllipsisIcon,
  MapPinPlusIcon,
  Redo2Icon,
  SaveIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { ActiveRunBanner } from "@/components/tasks/active-run-banner";
import { MapPicker } from "@/components/tasks/map-picker";
import { RouteMap } from "@/components/tasks/route-map";
import { SavedNotice, type SavedNoticeValue } from "@/components/tasks/saved-notice";
import { StopList } from "@/components/tasks/stop-list";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapVertexList } from "@/hooks/use-map-vertex-list";
import { useMaps } from "@/hooks/use-maps";
import { useSchedules } from "@/hooks/use-schedules";
import { useStepCatalogue } from "@/hooks/use-step-catalogue";
import { useTaskDraft } from "@/hooks/use-task-draft";
import { useTaskDraftHistory } from "@/hooks/use-task-draft-history";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { isTypingTarget } from "@/lib/keyboard";
import type { TaskStepState } from "@/lib/api/task";
import { editorViews, waypointEditor } from "@/lib/map/links";
import { draftIsUnsaved, type TaskDraft } from "@/lib/task/draft-store";
import {
  isNavStep,
  newStepDraft,
  stepDockVertices,
  stepDraftsSubmittable,
  stepIdFor,
  stepPatchFromVertex,
  stepRoute,
  stepTypeForVertex,
  toTemplateSteps,
  type StepDraft,
} from "@/lib/task/step";
import {
  formatDuration,
  insertStop,
  jobSummary,
  normalizeStops,
  stopLayout,
  stopOfRow,
  stopWaypointOrdinals,
} from "@/lib/task/stops";
import { stepLimits } from "@/lib/task/catalogue";
import { TASK_TEMPLATE_NAME_MAX, taskTemplateNameOk } from "@/lib/task/template";
import type { MapVertex } from "@/lib/types/map";

/**
 * A 40 px finger target from sm up, a 32 px icon square below. `!` because the
 * button's inline-start padding is more specific than a width variant.
 */
const HEADER_BUTTON = "sm:pointer-coarse:min-h-10 max-sm:size-8 max-sm:px-0!";
/** Delete ends the editor's job, so the page behind it is put away. */
const LEAVING_OVERLAY = "bg-black/80";

/** This page dispatches nothing, so no row has run state. Shared, not per render. */
const NO_STEP_STATES: ReadonlyMap<string, TaskStepState> = new Map();

/** Whether an edit handed back the list it was given, row for row. */
function sameRows(a: readonly StepDraft[], b: readonly StepDraft[]): boolean {
  return a.length === b.length && a.every((row, index) => row === b[index]);
}

/**
 * The task editor (/tasks/editor): the job's name, which is the heading
 * itself, and its route — a map to click waypoints on beside a card per stop
 * with what is done on the way there and on arrival.
 *
 * It is built for an engineer commissioning a site on a laptop: waypoints
 * first, in the order to visit them, then the actions at each. It runs and
 * schedules nothing; a saved job does both from its row on /tasks. The
 * overview hands a template over through the draft (lib/task/draft-store.ts),
 * so the URL carries no id.
 */
export function TaskEditor() {
  const router = useRouter();
  /**
   * Everything unsaved lives in the tab's draft, not component state, so a
   * trip to the map editor to place a missing stop finds the job as it was.
   */
  const [draft, updateDraft, clearDraft] = useTaskDraft();
  const { editing, chosenMap, name: draftName, steps } = draft;
  const history = useTaskDraftHistory(updateDraft);
  const { edit: editDraft } = history;
  /**
   * Every change to the steps: recorded for Undo, and read back as stops so
   * the cards can never be handed a list they cannot draw.
   */
  const edit = React.useCallback(
    (change: (current: StepDraft[]) => StepDraft[], tag: string | null = null) =>
      editDraft((current: TaskDraft) => {
        const next = normalizeStops(change(current.steps));
        return sameRows(next, current.steps) ? current : { ...current, steps: next };
      }, tag),
    [editDraft],
  );

  const catalogue = useStepCatalogue();
  const limits = React.useMemo(() => stepLimits(catalogue), [catalogue]);
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
  const mapGrid = editorMap?.grid ?? null;
  /** Where this map's waypoints are placed: its floor plan, else its 3D map. */
  const waypointLink = React.useMemo(
    () => (editorMap ? waypointEditor(editorMap, { from: "tasks" }) : null),
    [editorMap],
  );
  const views = React.useMemo(() => (editorMap ? editorViews(editorMap) : []), [editorMap]);
  const list = useMapVertexList(mapName);
  const vertices = list.vertices;
  // The catalogue's state first, so "no-map" never means "not asked yet".
  const verticesStatus =
    mapsStatus === "loading" ? "loading" : mapsStatus === "error" ? "error" : list.status;
  const { floors } = useMapFloors(mapName);

  const stopMarks = React.useMemo(() => stopWaypointOrdinals(steps), [steps]);
  const dockMarks = React.useMemo(() => stepDockVertices(steps), [steps]);
  const route = React.useMemo(() => stepRoute(steps), [steps]);
  const vertexName = React.useCallback(
    (id: string) => vertices.find((vertex) => vertex.id === id)?.name ?? null,
    [vertices],
  );
  const summary = jobSummary(steps, vertexName);

  /**
   * A row's key, or "start". The map's next click adds a stop after the stop
   * it belongs to, so a stop can be slotted into a route as well as appended.
   */
  const [selected, setSelected] = React.useState<number | "start" | null>(null);
  // A row that went (removed, undone) selects nothing rather than a ghost.
  const selection =
    selected === "start" || steps.some((step) => step.key === selected) ? selected : null;
  const insertAfter =
    selection === null || selection === "start" ? selection : stopOfRow(steps, selection);
  const layout = stopLayout(steps);
  const afterOrdinal =
    typeof insertAfter === "number"
      ? layout.stops.findIndex((stop) => stop.key === insertAfter) + 1
      : null;
  const pickHint =
    afterOrdinal !== null && afterOrdinal < layout.stops.length
      ? `Click a waypoint to add it as a stop after stop ${afterOrdinal}.`
      : insertAfter === "start" && layout.stops.length
        ? "Click a waypoint to add it as the first stop."
        : "Click waypoints in the order to visit them.";

  /**
   * The frame the stops scroll in from lg. Whatever is selected is brought
   * into it: a stop a map click just added at the end of a long route would
   * otherwise land below the frame's edge, out of sight.
   */
  const frameRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (typeof selection !== "number") return;
    const row = frameRef.current?.querySelector<HTMLElement>(`[data-row-key="${selection}"]`);
    if (!row) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [selection]);

  const pickWaypoint = (vertex: MapVertex) => {
    const row = { ...newStepDraft(stepTypeForVertex(vertex)), ...stepPatchFromVertex(vertex) };
    edit((current) => insertStop(current, insertAfter, row));
    setSelected(row.key);
  };

  /** The waypoint the map rings: the card under the pointer, else the selected stop's. */
  const [cardHover, setCardHover] = React.useState<string | null>(null);
  const [mapHover, setMapHover] = React.useState<string | null>(null);
  const selectedStop =
    typeof insertAfter === "number" ? steps.find((step) => step.key === insertAfter) : undefined;
  const highlight = cardHover ?? selectedStop?.vertexId ?? null;

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

  const stepsOk = stepDraftsSubmittable(steps, limits);
  const stepReason = !steps.length
    ? "Add at least one stop or action."
    : !stepsOk
      ? // Generic: each row already says what it is missing.
        "Some stops or actions are incomplete — the marked ones say what is missing."
      : null;

  /** Any stop means the template has to name the map its waypoints are on. */
  const hasStop = steps.some(isNavStep);
  const draftMapName = hasStop ? mapName : null;
  const saveReason =
    stepReason ??
    (draftMapName === null && hasStop ? "Pick a map for this job’s waypoints." : null);

  /** A job for another map saves but cannot run: its coordinates are in that map's frame. */
  const mapMismatch = draftMapName !== null && draftMapName !== activeMapName;
  const mismatchReason = mapMismatch
    ? `This job is for ${draftMapName}; the robot has ${activeMapName ?? "no map"} loaded, so it can be saved but not run or scheduled until that map is loaded.`
    : null;

  /**
   * Picked waypoints mean nothing on another map, so the switch clears them,
   * in one edit Undo takes back whole.
   */
  const selectMap = (next: string) => {
    if (next === mapName) return;
    editDraft((current) => ({
      ...current,
      chosenMap: next,
      steps: current.steps.map((step) =>
        isNavStep(step) && step.vertexId !== null
          ? { ...step, x: "", y: "", theta: "0", z: 0, vertexId: null, vertexMissing: false }
          : step,
      ),
    }));
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

  // Save stays pressable with work missing and points at it instead.
  const canSave = !library.busy;

  const listRef = React.useRef<HTMLDivElement>(null);
  /** The first marked row, scrolled to and named, for a Save pressed too soon. */
  const showFirstProblem = () => {
    const marked = listRef.current?.querySelector<HTMLElement>('[role="alert"]');
    if (!marked) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    marked.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  };

  /** Every save answers with a card, since every save stays on the page. */
  const [savedNotice, setSavedNotice] = React.useState<SavedNoticeValue | null>(null);
  const dismissSaved = React.useCallback(() => setSavedNotice(null), []);
  /** Shown under the heading when Save is pressed with work missing. */
  const [pressedEarly, setPressedEarly] = React.useState(false);

  /**
   * An update when a template is loaded, a create otherwise (or always, for a
   * copy). Every save stays: a create becomes the loaded template, so a
   * second press updates it rather than making another.
   */
  const save = (options: { copy?: boolean } = {}) => {
    if (!canSave) return;
    setSavedNotice(null);
    if (saveReason) {
      setPressedEarly(true);
      showFirstProblem();
      return;
    }
    setPressedEarly(false);
    if (!taskTemplateNameOk(draftName)) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }
    const name = options.copy
      ? `${draftName.trim()} (copy)`.slice(0, TASK_TEMPLATE_NAME_MAX)
      : draftName.trim();
    const body = { name, map_name: draftMapName, steps: toTemplateSteps(steps, limits) };
    setSentKeys(new Map(steps.map((step, index) => [stepIdFor(index, step.type), step.key])));
    const write = editing && !options.copy ? library.update(editing.id, body) : library.create(body);
    void write.then((saved) => {
      if (!saved) return;
      updateDraft((current) => ({
        ...current,
        editing: { id: saved.id, name: saved.name },
        name: saved.name,
      }));
      setSavedNotice({ name: saved.name, at: Date.now() });
    });
  };

  // Undo and Redo from the keyboard, but never out of a field, which has its own.
  const { undo, redo } = history;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        event.preventDefault();
        redo();
      } else if (event.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  /**
   * Delete, then leave, or Save would quietly re-create the job under a new id.
   * Confirmed in an AlertDialog (no backdrop dismiss) because nothing brings
   * the job back. The dialog names its schedules because they survive: each
   * holds its own copy of the steps.
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

  const summaryParts = [
    `${summary.stops} ${summary.stops === 1 ? "stop" : "stops"}`,
    summary.waitSeconds > 0 ? `${formatDuration(summary.waitSeconds)} of waiting` : null,
    summary.end
      ? `ends ${summary.end.dock ? "docked at" : "at"} ${summary.end.name ?? "a waypoint not picked yet"}`
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <>
      {/* One row that wraps below sm, the name on a line of its own: beside
        * the buttons a phone left it a few letters. */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 max-sm:basis-full">
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
          {pressedEarly && saveReason && (
            <p role="alert" className="mt-1 text-[11px] leading-snug text-signal-warn">
              {saveReason}
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
            onClick={() => save()}
            disabled={!canSave}
            aria-label="Save"
            className={HEADER_BUTTON}
          >
            <SaveIcon data-icon="inline-start" aria-hidden />
            <span className="max-sm:hidden">Save</span>
          </Button>
          {editing && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More for this job"
                disabled={library.busy}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 pointer-coarse:size-10"
              >
                <EllipsisIcon className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem disabled={!canSave} onClick={() => save({ copy: true })}>
                  <CopyIcon aria-hidden />
                  Save as copy
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Out of Save's row: the two sat 8 px apart. */}
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    library.clearError();
                    setConfirmingDelete(true);
                  }}
                >
                  <Trash2Icon aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      <ActiveRunBanner trackedTaskId={null} />

      {/* From lg the map sets the row's height and the stops stretch to it,
        * so the two columns end on one line however long the route is. The
        * map takes three fifths: it is what a route is picked on. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          aria-label="Map"
          className="space-y-1.5 overflow-hidden rounded-md border border-hairline bg-panel p-2"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <MapPicker maps={maps} value={mapName} disabled={false} onPick={selectMap} />
            {/* Opens the map's floor plan editor in Waypoints mode, or its
              * 3D map with Waypoint armed; its back button returns here. */}
            {waypointLink !== null && (
              <Link
                href={waypointLink.href}
                aria-label={`Add waypoints on the ${waypointLink.surface}`}
                className="instrument-label flex h-6 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
              >
                <MapPinPlusIcon className="size-3.5" aria-hidden />
                Add waypoints
              </Link>
            )}
          </div>
          {mapName === null || editorMap === null ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              Pick a map to plan this job&apos;s route on.
            </p>
          ) : views.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-muted-foreground">
              This map has no floor plan or 3D map to pick waypoints on.
            </p>
          ) : (
            <>
              <RouteMap
                // A new map starts on its own first view and floor.
                key={mapName}
                mapName={mapName}
                mapGrid={mapGrid}
                views={views}
                vertices={vertices}
                stopMarks={stopMarks}
                dockMarks={dockMarks}
                route={route}
                onPick={pickWaypoint}
                highlight={highlight}
                onHover={(vertex) => setMapHover(vertex?.id ?? null)}
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                {vertices.length === 0 && verticesStatus === "ok"
                    ? "This map has no waypoints yet. Add some, then click them here."
                    : `${pickHint} A charger adds a Dock.`}
              </p>
            </>
          )}
          {mismatchReason && (
            <p className="text-[11px] leading-snug text-signal-caution">{mismatchReason}</p>
          )}
        </section>

        {/* contain-size keeps the list out of the row's sizing, or a long
          * route would grow the row past the map; the floor is for the map's
          * empty states, which are a line tall. */}
        <section
          aria-label="Stops"
          ref={listRef}
          className="flex flex-col gap-2 lg:min-h-96 lg:contain-size"
        >
          {/* Over what they act on, as the map editors' tool strips are: Undo
            * takes back stops, actions and a map switch, never the name,
            * which its field undoes. In the page header it read as undoing
            * the save beside it. */}
          <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="instrument-label text-muted-foreground">Route</span>
            <p className="readout min-w-0 text-[12px] text-muted-foreground" aria-label="Job summary">
              {summaryParts.join(" · ")}
            </p>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={!history.canUndo}
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
              >
                <Undo2Icon data-icon="inline-start" aria-hidden />
                Undo
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={redo}
                disabled={!history.canRedo}
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
              >
                <Redo2Icon data-icon="inline-start" aria-hidden />
                Redo
              </Button>
            </div>
          </div>
          {/* From lg the stops scroll in what the map leaves under the Route
            * strip, so a long route never pushes the map, the strip or Save
            * out of view. */}
          <div
            ref={frameRef}
            className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
          >
            <StopList
              steps={steps}
              catalogue={catalogue}
              vertices={vertices}
              verticesStatus={verticesStatus}
              mapName={mapName}
              waypointLink={waypointLink}
              floors={floors}
              stopMarks={stopMarks}
              disabled={false}
              stepStates={NO_STEP_STATES}
              refusal={refusal}
              selected={selection}
              onSelect={setSelected}
              hoveredVertex={mapHover}
              onHoverVertex={setCardHover}
              edit={edit}
            />
          </div>
        </section>
      </div>
    </>
  );
}
