"use client";

import * as React from "react";

import { ArmedHint } from "@/components/console/armed-hint";
import {
  GridCanvas,
} from "@/components/maps/grid-canvas";
import {
  editStateOf,
  type CellProbe,
  type DrawKind,
  type EditMode,
  type EditTool,
  type VertexGesture,
  type VertexTool,
  type ZoneTool,
} from "@/lib/map/editor";
import { GridStatus } from "@/components/maps/grid-status";
import {
  EditorDrawBar,
  EditorToolBar,
  SaveNote,
  type SaveState,
} from "@/components/maps/grid-toolbar";
import { VertexPanel } from "@/components/maps/vertex-panel";
import { useSaveMapGrid } from "@/hooks/use-map-actions";
import { useMapGrid } from "@/hooks/use-map-grid";
import { useMapVertices, type UseMapVertices } from "@/hooks/use-map-vertices";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import type { VertexChanges } from "@/lib/api/vertex";
import { isTypingTarget } from "@/lib/keyboard";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import { FREE, type GridValue } from "@/lib/map/grid";
import {
  applyPatch,
  createUndoStack,
  popRedo,
  popUndo,
  pushPatch,
  type GridPatch,
} from "@/lib/map/patch";
import type { GridSession } from "@/lib/map/session";
import { DEFAULT_VERTEX_TYPE } from "@/lib/map/vertex";
import { canCloseZone, newZoneId, type ZonePoint, type ZonePolygon } from "@/lib/map/zone";
import type { VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

const DEFAULT_BRUSH = 7;

/**
 * The editor opens in Pan, not in Brush.
 *
 * Opening armed with a brush means the first thing an operator does on a freshly
 * loaded map — drag it to the corner they came here to look at — is a stroke,
 * and on a 1602x1502 grid at fit scale that stroke is hundreds of cells wide
 * before they notice. Undo would reach it, but only if they realised; the map is
 * blitted literally and a Free stroke across free space is invisible.
 *
 * Painting therefore costs two clicks — what to draw, then Brush — which is
 * the trade this makes: explicit arming for the destructive default, in
 * exchange for "look around" being the safe thing that needs no decision. The
 * editor now opens one step further back still, with nothing chosen to draw at
 * all (see DrawKind), and every change of Draw choice lands back on Pan.
 * Right/middle-drag and Space still pan whatever the tool is — Pan being the
 * *default* does not make it the only way.
 */
const DEFAULT_TOOL: EditTool = "pan";

/**
 * Vertex mode opens in Pan too, for the same reason and one more.
 *
 * The same reason: the first thing an operator does on arriving is drag the map
 * to the corner they came for, and until this existed that drag placed a vertex
 * — a whole staged draft, panel and all — because vertex mode had no unarmed
 * state at all. Every press on bare map was a placement.
 *
 * The one more: unlike a stray brush stroke, a stray vertex is not undoable.
 * The vertex layer writes through to the backend and has no history (see
 * hooks/use-map-vertices.ts), so the only reason the old behaviour was
 * survivable is that a draft still needs a name typed before it becomes a row.
 * That is a confirmation step, not a safe default.
 *
 * Placing therefore costs one click on the Tool row, and Escape gives the map
 * back — the same trade grid mode makes for its brush.
 */
const DEFAULT_VERTEX_TOOL: VertexTool = "pan";

/**
 * Zone mode opens in Pan as well, for DEFAULT_VERTEX_TOOL's reason. A stray
 * corner is cheap to drop, unlike a stray vertex; what Pan-as-resting buys
 * here is the moment the editor dims the map and asks which tool to pick,
 * which is the one place the console tells the operator what a zone tool is.
 */
const DEFAULT_ZONE_TOOL: ZoneTool = "pan";

/**
 * Loads the map and shows the guard states; EditorSurface does the editing.
 *
 * The split exists so that everything belonging to one loaded grid — the undo
 * history — is initialised by *mounting* the surface rather than
 * by clearing state in an effect when the session changes. Patches index into a
 * specific buffer, so carrying a history across a load would corrupt the new one,
 * and a remount makes that impossible by construction.
 */
export function MapGridEditor({
  name,
  initialMode = "grid",
  onDirtyChange,
}: {
  name: string;
  /**
   * The mode the surface opens in. Grid unless a link asked for Waypoints —
   * the task editor's does, for an operator who came here to add one stop.
   * No link asks for zones. The tool still opens on Pan either way; see the
   * note above DEFAULT_TOOL.
   */
  initialMode?: EditMode;
  /** Lets the page guard its back button; see its comment on why it needs this. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { session, status, error } = useMapGrid(name);
  /**
   * Loaded here rather than inside EditorSurface, and that placement is the
   * point of the split. EditorSurface is keyed on the session, so it remounts
   * whenever the grid is reloaded; the vertex list belongs to the *map*, not to
   * one buffer of its cells, and would otherwise be refetched — and any staged
   * edit thrown away — by something that has nothing to do with it.
   */
  const vertices = useMapVertices(name);

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-hairline bg-panel p-4">
          <p className="instrument-label text-muted-foreground">Cannot edit</p>
          <p className="mt-2 text-sm">{error ?? "The map could not be loaded."}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <p className="instrument-label flex h-full items-center justify-center text-muted-foreground">
        Loading {name}…
      </p>
    );
  }

  return (
    <EditorSurface
      key={session.id}
      session={session}
      vertices={vertices}
      initialMode={initialMode}
      onDirtyChange={onDirtyChange}
    />
  );
}

/**
 * The editor shell: everything except pixels.
 *
 * It owns the tool state, the undo history, the keyboard shortcuts and the save
 * flow; GridCanvas owns the buffer, the mirror and the view. The two meet at
 * `GridSession` — see lib/map/session.ts for why the repaint hook lives there
 * rather than behind an imperative handle.
 */
function EditorSurface({
  session,
  vertices,
  initialMode,
  onDirtyChange,
}: {
  session: GridSession;
  vertices: UseMapVertices;
  initialMode: EditMode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  /**
   * What a press puts on the map, or nothing — the Draw strip's choice, and
   * the one `mode` and `value` below follow from (see editStateOf). Opens with
   * nothing chosen, unless a link asked for Waypoints.
   */
  const [drawKind, setDrawKind] = React.useState<DrawKind | null>(
    initialMode === "vertex" ? "waypoint" : null,
  );
  const [mode, setMode] = React.useState<EditMode>(initialMode);
  const [tool, setTool] = React.useState<EditTool>(DEFAULT_TOOL);
  const [vertexTool, setVertexTool] = React.useState<VertexTool>(DEFAULT_VERTEX_TOOL);
  const [zoneTool, setZoneTool] = React.useState<ZoneTool>(DEFAULT_ZONE_TOOL);
  // Free by default: erasing phantom obstacles is the reason this screen exists.
  const [value, setValue] = React.useState<GridValue>(FREE);
  const [brush, setBrush] = React.useState<number>(DEFAULT_BRUSH);

  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [save, setSaveState] = React.useState<SaveState>({ kind: "idle" });

  /**
   * Bumped by every edit, so a save can tell whether the buffer moved under it.
   *
   * `fetch` copies a BufferSource body synchronously at the call, so a stroke
   * painted while the request is in flight is *not* in what reached disk —
   * clearing `dirty` on that response would mark unsaved cells saved.
   */
  const revisionRef = React.useRef(0);

  const [hover, setHover] = React.useState<CellProbe | null>(null);
  const [scale, setScale] = React.useState(1);
  const [fitNonce, setFitNonce] = React.useState(0);
  const [spacePan, setSpacePan] = React.useState(false);

  const historyRef = React.useRef(createUndoStack());

  /*
   * Vertex-layer state. None of it feeds `dirty`, and that is the whole point of
   * the write-through design in useMapVertices: the page's back-button guard and
   * the toolbar's Unsaved chip keep describing the gridmap only, so a staged
   * vertex can never be mistaken for unsaved cells.
   */
  const [vertexType, setVertexType] = React.useState<VertexType>(DEFAULT_VERTEX_TYPE);
  const [draft, setDraft] = React.useState<PlanarPose | null>(null);
  /**
   * Every highlighted vertex, not just the one the form is editing.
   *
   * A list rather than a nullable id because the Select tool's band produces
   * sets, and rather than a Set because it is handed to GridCanvas, which is
   * memoized — React state keeps its identity between changes, a Set rebuilt in
   * a render would not. One entry is the ordinary case and behaves exactly as
   * the old single selection did; the panel only opens its editing form at
   * exactly one, because none of what that form does (rename, retype, re-aim)
   * has a sensible meaning spread across several.
   */
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  /**
   * A re-aim of the selected vertex, awaiting Save.
   *
   * Only ever a new *heading* now: a vertex is re-aimed by dragging on its own
   * marker, which anchors at the stored position (see GridCanvas's pointer-down).
   * Moving one to a different place is the dashboard's job — there the stop is
   * drawn over the live cloud, which is the view that can actually show it half
   * inside a wall.
   */
  const [stagedPose, setStagedPose] = React.useState<PlanarPose | null>(null);
  /** The last point the shell asked the canvas to centre on; see GridCanvas.focus. */
  const [focus, setFocus] = React.useState<{ x: number; y: number } | null>(null);

  /*
   * Zone-layer state. Like the vertex layer's, none of it feeds `dirty`: the
   * Unsaved chip and the back-button guard describe the gridmap only. Unlike
   * the vertex layer's, none of it reaches the backend either — there is no
   * zone endpoint yet, so a zone drawn here lives until the page is left and
   * no longer. That is said here so nobody adds a "save your zones" prompt
   * for state that has nowhere to go.
   */
  const [zones, setZones] = React.useState<ZonePolygon[]>([]);
  const [zoneDraft, setZoneDraft] = React.useState<ZonePoint[]>([]);
  /**
   * The zone Remove would take. One at most: a zone's only edit is removal,
   * and a band over several is not worth a Select tool of its own here.
   */
  const [selectedZoneId, setSelectedZoneId] = React.useState<string | null>(null);

  /**
   * The robot's pose, when it is a pose on the map open here.
   *
   * It is both the source of the panel's capture button and what the canvas
   * draws the robot's footprint from, so the two can never disagree about where
   * the robot is — the mark on the map is the pose the button would stage.
   *
   * Read at 1 Hz from the console's shared poll, so this component re-renders at
   * that rate; the hook memoises on the values, so a parked robot costs one
   * bailed-out memo compare and no repaint. See useRobotMapPose for why it is
   * not the 20 Hz telemetry socket.
   */
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(session.name);

  // Destructured because the hook returns a fresh object each render: passing
  // `vertices.create` inline would give GridCanvas a new callback identity every
  // time and defeat its React.memo, which exists so a pan cannot re-render the
  // toolbar. The list itself is state, so its identity is stable between changes.
  //
  // status / error / busy are the panel's three, and deliberately reach nothing
  // else — GridCanvas never sees them, so a vertex write in flight cannot
  // re-render the canvas. All eight are prefixed because `save` and `dirty` in
  // this same scope describe the *gridmap*: a bare `error` or `busy` beside them
  // reads as if it did too.
  const {
    vertices: vertexList,
    status: vertexStatus,
    error: vertexError,
    busy: vertexBusy,
    create: createVertex,
    update: updateVertex,
    remove: removeVertex,
    clearError: clearVertexError,
  } = vertices;

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selected = vertexList.find((vertex) => vertex.id === selectedId) ?? null;

  const clearVertexEdit = React.useCallback(() => {
    setDraft(null);
    setSelectedIds([]);
    setStagedPose(null);
  }, []);

  const changeMode = React.useCallback(
    (next: EditMode) => {
      setMode(next);
      // Both directions land unarmed. Arriving in vertex mode still holding
      // Place from last time means the drag that was meant as "show me the other
      // end of the corridor" stages a vertex instead — which is the whole thing
      // DEFAULT_VERTEX_TOOL exists to stop, and a mode toggle is exactly when it
      // would come back.
      setVertexTool(DEFAULT_VERTEX_TOOL);
      setZoneTool(DEFAULT_ZONE_TOOL);
      // Back to grid mode with a draft still staged would leave a dashed marker
      // on the canvas and no panel to commit or dismiss it.
      if (next === "grid") clearVertexEdit();
      // The same for a shape in flight: out of zone mode nothing can finish
      // it, so the dashed corners would just sit there. Finished zones stay,
      // drawn in every mode like the vertices, but none stays selected — no
      // other mode offers Remove.
      setZoneDraft([]);
      setSelectedZoneId(null);
    },
    [clearVertexEdit],
  );

  /**
   * Arm a waypoint tool. Going back to Pan also drops whatever waypoint is
   * selected or staged, by request: Pan is "I am done with that one, let me
   * look around", and a marker left lit — or a just-placed draft left open in
   * the panel — would keep claiming the operator's attention for an edit they
   * have walked away from.
   */
  const chooseVertexTool = React.useCallback(
    (next: VertexTool) => {
      setVertexTool(next);
      if (next === "pan") clearVertexEdit();
    },
    [clearVertexEdit],
  );

  /**
   * Arm a zone tool. Pan drops the shape in flight, chooseVertexTool's rule:
   * it is "I am done with that one", and half a shape left dashed on the map
   * would keep asking to be finished.
   */
  const chooseZoneTool = React.useCallback((next: ZoneTool) => {
    setZoneTool(next);
    if (next === "pan") {
      setZoneDraft([]);
      setSelectedZoneId(null);
    }
  }, []);

  /**
   * A corner on bare map also drops the selection: the operator has moved on
   * to drawing, and a zone left lit would keep offering a Remove for the
   * wrong shape.
   */
  const addZonePoint = React.useCallback((point: ZonePoint) => {
    setSelectedZoneId(null);
    setZoneDraft((draft) => [...draft, point]);
  }, []);

  const pickZone = React.useCallback((id: string | null) => setSelectedZoneId(id), []);

  const removeZone = React.useCallback(() => {
    if (!selectedZoneId) return;
    setZones((current) => current.filter((zone) => zone.id !== selectedZoneId));
    setSelectedZoneId(null);
  }, [selectedZoneId]);

  const dropZoneDraft = React.useCallback(() => setZoneDraft([]), []);

  /**
   * Close the shape in flight into a zone.
   *
   * Reads `zoneDraft` from the closure, so its identity changes with every
   * corner; that is fine, because GridCanvas re-renders on the `zoneDraft`
   * prop anyway. What it must not be is `setZones` nested inside a
   * `setZoneDraft` updater to keep the identity stable: StrictMode runs an
   * updater twice, and the zone would be added twice.
   */
  const closeZone = React.useCallback(() => {
    if (!canCloseZone(zoneDraft)) return;
    setZones((current) => [...current, { id: newZoneId(), points: zoneDraft }]);
    setZoneDraft([]);
  }, [zoneDraft]);

  /**
   * Put a Draw choice down on the map, or pick it up again (`null`).
   *
   * Every change lands on Pan, in both tool axes, for DEFAULT_TOOL's reason:
   * the choice says what a press *would* put there, and the tool is a second,
   * deliberate step. Through changeMode, never setMode, so leaving Waypoint
   * with a draft staged still drops it.
   */
  const chooseDraw = React.useCallback(
    (next: DrawKind | null) => {
      const state = editStateOf(next);
      setDrawKind(next);
      changeMode(state.mode);
      setTool(DEFAULT_TOOL);
      if (state.value !== undefined) setValue(state.value);
    },
    [changeMode],
  );

  /**
   * Make `id` the subject of the panel, dropping whatever the last one was.
   *
   * Selecting is also how you leave a draft or a staged re-aim: neither survives
   * a change of subject.
   */
  const selectVertex = React.useCallback(
    (id: string | null) => {
      clearVertexEdit();
      setSelectedIds(id ? [id] : []);
      clearVertexError();
    },
    [clearVertexEdit, clearVertexError],
  );

  /**
   * Shift-click on a marker: add it, or drop it if it is already in.
   *
   * The half of multi-select a rectangle cannot do — three stops scattered down
   * a corridor have no band that catches them and nothing else. Toggling down to
   * exactly one is not a special case: the panel simply opens its editing form
   * again, because that is what one selected vertex means everywhere else.
   */
  const toggleVertex = React.useCallback(
    (id: string) => {
      setDraft(null);
      setStagedPose(null);
      clearVertexError();
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((other) => other !== id)
          : [...current, id],
      );
    },
    [clearVertexError],
  );

  /** A finished band. `additive` is Shift: union rather than replace. */
  const selectMany = React.useCallback(
    (ids: string[], additive: boolean) => {
      setDraft(null);
      setStagedPose(null);
      clearVertexError();
      setSelectedIds((current) =>
        additive
          ? [...current, ...ids.filter((id) => !current.includes(id))]
          : ids,
      );
    },
    [clearVertexError],
  );

  const handleVertexGesture = React.useCallback(
    ({ id, pose }: VertexGesture) => {
      if (id !== null) {
        // Re-aimed in place. The canvas echoes the stored heading back verbatim
        // when the drag stayed inside its deadzone, so this exact comparison
        // holds and a plain click-to-select does not arm the Save button.
        const existing = vertexList.find((vertex) => vertex.id === id);
        if (existing && existing.theta === pose.theta) return;
        setStagedPose(pose);
        return;
      }

      setSelectedIds([]);
      setStagedPose(null);
      setDraft(pose);
    },
    [vertexList],
  );

  /**
   * Stage a draft where the robot is standing, and go and look at it.
   *
   * A snapshot, not a live binding: `robotPose` keeps moving after this, and a
   * draft that crept across the map while its name was being typed would be a
   * vertex nobody placed. The same clearing as a press on the map — a draft and
   * a selection are mutually exclusive — so it is usable with a vertex already
   * open in the form.
   */
  const placeAtRobot = React.useCallback(() => {
    if (!robotPose) return;
    setSelectedIds([]);
    setStagedPose(null);
    setDraft(robotPose);
    // A fresh object every press, because identity is what triggers the canvas:
    // pressing again after panning away has to bring the marker back.
    setFocus({ x: robotPose.x, y: robotPose.y });
  }, [robotPose]);

  const createFromDraft = React.useCallback(
    async (name: string, type: VertexType) => {
      if (!draft) return;
      const created = await createVertex({ name, type, ...draft });
      // Cleared rather than selected: placing a run of stops is the common case,
      // and the list view is where the next one starts.
      if (created) setDraft(null);
    },
    [createVertex, draft],
  );

  const saveSelected = React.useCallback(
    async (changes: VertexChanges) => {
      if (!selectedId) return;
      if (await updateVertex(selectedId, changes)) setStagedPose(null);
    },
    [selectedId, updateVertex],
  );

  /**
   * Delete everything selected — one vertex from the form, or a whole band.
   *
   * One request per id, run in series. Not caution about the LAN: useMapVertices
   * has a single `busy` flag and a single `error` slot for the whole hook, so
   * concurrent writes would race the flag and leave the panel showing whichever
   * failure happened to land last. In series, the first failure stops the run
   * with the rest still selected, which is both an honest report and the state a
   * retry wants. There is no batch endpoint to use instead — only create takes a
   * list; PUT and DELETE are per id (see lib/api/vertex.ts).
   */
  const deleteSelected = React.useCallback(async () => {
    for (let index = 0; index < selectedIds.length; index += 1) {
      if (!(await removeVertex(selectedIds[index]))) {
        // The failed one stays selected with everything after it, so the count in
        // the panel is what is left to do rather than what was asked for.
        setSelectedIds(selectedIds.slice(index));
        return;
      }
    }
    clearVertexEdit();
  }, [selectedIds, removeVertex, clearVertexEdit]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const commitPatch = React.useCallback((patch: GridPatch) => {
    pushPatch(historyRef.current, patch);
    setCanUndo(true);
    setCanRedo(false);
    setDirty(true);
    revisionRef.current += 1;
    // The note describes the buffer as it was saved; once the buffer moves on it
    // is stale, and "Saved" next to a lit Unsaved chip is the one genuinely
    // confusing pair this panel can show.
    setSaveState({ kind: "idle" });
  }, []);

  const step = React.useCallback(
    (direction: "undo" | "redo") => {
      const stack = historyRef.current;
      const patch = direction === "undo" ? popUndo(stack) : popRedo(stack);
      if (!patch) return;

      const side = direction === "undo" ? "before" : "after";
      applyPatch(session.grid, patch, side);
      session.repaint?.(patch.bounds);
      setCanUndo(stack.undo.length > 0);
      setCanRedo(stack.redo.length > 0);
      // Still dirty after undoing to the start: the stack is byte-capped, so an
      // empty undo stack does not prove the buffer matches what was loaded.
      setDirty(true);
      revisionRef.current += 1;
      setSaveState({ kind: "idle" });
    },
    [session],
  );

  const undo = React.useCallback(() => step("undo"), [step]);
  const redo = React.useCallback(() => step("redo"), [step]);
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);

  // `mutate` alone, not the whole result: it is bound once per observer, so
  // `onSave` keeps its identity across the mutation's state changes.
  const { mutate: saveGrid } = useSaveMapGrid();

  /**
   * Write the buffer back, and report what the running stack made of it.
   *
   * The grid is not refetched afterwards, deliberately (useSaveMapGrid says
   * why): the local buffer *is* what was written, byte for byte. The outcome
   * is kept in `save` rather than read off the mutation because it is
   * entangled with the revision guard — "saved" is only true of the bytes as of
   * `sent`, and a stroke painted since has to put it back to idle.
   */
  const onSave = React.useCallback(() => {
    const sent = revisionRef.current;
    setSaveState({ kind: "saving" });

    saveGrid(
      { name: session.name, grid: session.grid },
      {
        onSuccess: (result) => {
          // Only the bytes as of `sent` are on disk; anything painted since is
          // not.
          if (revisionRef.current === sent) setDirty(false);
          setSaveState({
            kind: "saved",
            active: result.active,
            reloaded: result.reloaded,
            message: result.message,
          });
        },
        // `dirty` stays true so the button re-enables for a retry.
        onError: (cause) => {
          setSaveState({ kind: "failed", message: cause.message });
        },
      },
    );
  }, [saveGrid, session]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * Escape is deliberately above the typing guard, unlike every other
       * shortcut here.
       *
       * A staged draft autofocuses VertexPanel's name field, so an Escape that
       * respected the guard would be dead in precisely the state an operator
       * presses it in — "I did not mean to place that". Nothing in this editor's
       * fields wants Escape for itself, so there is nothing to swallow.
       *
       * It does both halves of "put the mouse back": it drops whatever is staged
       * and disarms every tool axis. One press, not two, because the operator
       * pressing it wants the map back and does not care which of the states
       * is the one holding it.
       *
       * The one exception is a zone shape in flight, which Escape drops while
       * keeping Forbidden zone and Shape armed. A waypoint draft is one click
       * to redo, so throwing it out with everything else costs nothing; five
       * corners are not, and the next thing after dropping a mis-drawn shape
       * is drawing it again. A selected zone is put down the same way — it
       * is the lit thing on screen, and the press is aimed at it. The next
       * press then puts the choice down as usual.
       */
      if (event.key === "Escape") {
        event.preventDefault();
        if (zoneDraft.length) {
          dropZoneDraft();
          return;
        }
        if (selectedZoneId) {
          setSelectedZoneId(null);
          return;
        }
        // Puts the Draw choice down as well, which drops a staged draft and
        // lands every tool axis on Pan — one press for "give me the map back".
        chooseDraw(null);
        return;
      }

      // VertexPanel's name field is the case this was written in anticipation of:
      // `0` and Space are single-key shortcuts, and an editor's shortcuts are
      // exactly what silently eats typing. Ctrl+Z falls through to the field too,
      // becoming the browser's native text undo, which is what you want there.
      if (isTypingTarget(event.target)) return;

      // Below the typing guard, unlike Escape: Enter in the waypoint form is
      // the form's submit, and a shape can only be in flight in zone mode,
      // where no form is mounted.
      if (event.key === "Enter" && canCloseZone(zoneDraft)) {
        event.preventDefault();
        closeZone();
        return;
      }
      // Below the guard for the same reason: Backspace in a field is editing.
      if ((event.key === "Delete" || event.key === "Backspace") && selectedZoneId) {
        event.preventDefault();
        removeZone();
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        // Stop the page-scroll default even though this page does not scroll: it
        // would still scroll an ancestor if the layout ever gains one.
        event.preventDefault();
        setSpacePan(true);
        return;
      }
      if (event.key === "0" && !mod) {
        event.preventDefault();
        fit();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePan(false);
    };
    // A window blur mid-Space would otherwise leave the editor stuck in pan mode.
    const onBlur = () => setSpacePan(false);

    // On window rather than the canvas: the shortcuts have to work without having
    // clicked the canvas first.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // Re-subscribing on every corner is harmless: the listeners are on window
    // and capture nothing that a pointer gesture in flight depends on.
  }, [undo, redo, fit, chooseDraw, zoneDraft, dropZoneDraft, closeZone, selectedZoneId, removeZone]);

  /**
   * Covers reload and tab close only. The App Router has no navigation blocker, so
   * an in-app link away from here cannot be intercepted — the page's back button
   * asks for confirmation itself.
   */
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /**
   * Forbidden zone chosen, no tool armed yet: the map dims and asks. The
   * other kinds do not need this — a brush and a pin are self-explanatory —
   * but "Shape" is a word the operator meets here for the first time, and
   * the dim is what says the map is waiting on that choice rather than broken.
   */
  const zoneUnarmed = drawKind === "zone" && zoneTool === "pan";

  const vertexPanelProps = {
    vertices: vertexList,
    status: vertexStatus,
    error: vertexError,
    busy: vertexBusy,
    type: vertexType,
    onTypeChange: setVertexType,
    draft,
    selected,
    selectedIds,
    stagedPose,
    robotPose,
    robotPoseReason,
    onUseRobotPose: placeAtRobot,
    onSelect: selectVertex,
    // A draft and a selection are mutually exclusive by construction, so
    // clearing the whole vertex edit *is* "drop the draft", and the same call
    // is what the band selection's Clear does.
    onCancelDraft: clearVertexEdit,
    onClearSelection: clearVertexEdit,
    onCreate: createFromDraft,
    onSave: saveSelected,
    onDelete: deleteSelected,
  };

  return (
    // data-zoom is the view's scale in percent, for the e2e suite: nothing on
    // screen shows it since the readout lost its Zoom row, and the pinch test
    // has to prove the second finger zoomed rather than only that it did not
    // paint. An attribute, not text, so it can never become an on-screen
    // diagnostic by accident. data-zones is the finished zone count, for the
    // same suite and the same reason: the canvas exposes nothing, and the
    // test has to prove a shape closed rather than only that clicks landed.
    <div
      className="relative h-full w-full"
      data-zoom={Math.round(scale * 100)}
      data-zones={zones.length}
    >
      <GridCanvas
        session={session}
        mode={mode}
        tool={tool}
        vertexTool={vertexTool}
        value={value}
        brush={brush}
        spacePan={spacePan}
        fitNonce={fitNonce}
        zoomStep={zoomStep}
        focus={focus}
        onStrokeCommit={commitPatch}
        onHover={setHover}
        onScaleChange={setScale}
        vertices={vertexList}
        robotPose={robotPose}
        draft={draft}
        selectedIds={selectedIds}
        onVertexPick={selectVertex}
        onVertexToggle={toggleVertex}
        onMarquee={selectMany}
        onVertexGesture={handleVertexGesture}
        zoneTool={zoneTool}
        zones={zones}
        zoneDraft={zoneDraft}
        onZonePoint={addZonePoint}
        onZoneClose={closeZone}
        selectedZoneId={selectedZoneId}
        onZonePick={pickZone}
      />

      {/* The wash is a sibling placed before the strips, so DOM order alone
        * stacks the toolbars, the save note and the status readout above it.
        * Pointer-transparent, so right-, middle- and Space-drag still pan the
        * dimmed map. Grey rather than a theme surface because the grid never
        * follows the theme (see lib/map/draw.ts), and the wash has to read
        * the same over white free space in both. The hint sits outside the
        * aria-hidden wash so its status role is heard. */}
      {zoneUnarmed && (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/25" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <ArmedHint tone="cmd">Select the shape to work with</ArmedHint>
          </div>
        </>
      )}

      {/* One row across the top, as on the dashboard: Editor at the left, Draw
        * at the right, wrapping onto two lines on a phone rather than
        * overlapping. The overlay covers the canvas but is pointer-transparent,
        * so the map behind its empty stretches still takes a drag — only the
        * strips and the panels in it catch the pointer. It spans the full
        * height so the waypoint panel can drop to its bottom edge on a phone. */}
      <div className="pointer-events-none absolute inset-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <EditorToolBar
            className="pointer-events-auto"
            onFit={fit}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            dirty={dirty}
            save={save}
            onSave={onSave}
            drawKind={drawKind}
            tool={tool}
            onToolChange={setTool}
            vertexTool={vertexTool}
            onVertexToolChange={chooseVertexTool}
            zoneTool={zoneTool}
            onZoneToolChange={chooseZoneTool}
            canCloseZone={canCloseZone(zoneDraft)}
            onCloseZone={closeZone}
            canRemoveZone={selectedZoneId !== null}
            onRemoveZone={removeZone}
            brush={brush}
            onBrushChange={setBrush}
          />
          <EditorDrawBar
            className="pointer-events-auto"
            drawKind={drawKind}
            onDrawKindChange={chooseDraw}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        </div>

        {/* Under each strip, what it reports into: the save note under the
          * strip that holds Save, the waypoint panel under the one that chose
          * Waypoint. On a phone the panel drops to the bottom of the canvas
          * instead, where the stacked strips leave it room — one panel, placed
          * by CSS, so there is one form to type in.
          *
          * The panel is mounted only in vertex mode, because unmounting
          * discards nothing that the mode switch was not already discarding —
          * changeMode("grid") clears draft / selectedIds / stagedPose, and
          * VertexForm is keyed on "draft" or selected.id, so its local
          * name/type state is already gone by then. The one thing worth
          * keeping across the toggle, `vertexType`, lives up here for exactly
          * that reason. */}
        <div className="flex min-h-0 items-start justify-between gap-2">
          <SaveNote save={save} className="pointer-events-auto max-w-72" />
          {mode === "vertex" && (
            <VertexPanel
              className="pointer-events-auto ml-auto max-h-full min-h-0 overflow-y-auto max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[45%] max-sm:w-auto"
              {...vertexPanelProps}
            />
          )}
        </div>
      </div>

      {/* The other half of "Use robot position" — the pose you capture is the
        * one you drove the robot to — is now the masthead's drive panel
        * (DriveDisclosure), which this editor no longer mounts itself. It still
        * cannot eat this editor's shortcuts: it comes up disarmed and takes no
        * keyboard until it is armed, and its WASD/QE/AD set does not overlap
        * Space / 0 / Ctrl+Z in any case. */}

      {/* Not on a phone, nor on any screen too short to hold it beside the
        * toolbar: its cell readout follows a hover, which a finger does not
        * have, and the bottom of a phone is the waypoint panel's. */}
      <GridStatus
        className="absolute bottom-3 left-3 hidden sm:block [@media(max-height:480px)]:hidden"
        meta={session.meta}
        hover={hover}
      />
    </div>
  );
}
