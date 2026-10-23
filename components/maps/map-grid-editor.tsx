"use client";

import * as React from "react";

import { ViewportBoundary } from "@/components/console/fault-boundary";
import { ArmedHint } from "@/components/console/armed-hint";
import { TONE_TEXT, overlayPanel } from "@/components/console/instrument";
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
import { useSaveMapGrid, useSaveMapKeepout } from "@/hooks/use-map-actions";
import { useMapGrid } from "@/hooks/use-map-grid";
import { useMapKeepout } from "@/hooks/use-map-keepout";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
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
import { editBytes, remapWaypointIds, type EditorEdit } from "@/lib/map/history";
import type { GridSession } from "@/lib/map/session";
import { DEFAULT_VERTEX_TYPE } from "@/lib/map/vertex";
import {
  localVertexId,
  planVertexSave,
  rebaseVertices,
  sameVertices,
  vertexSaveFailure,
  vertexSaveSummary,
} from "@/lib/map/vertex-stage";
import {
  canCloseZone,
  mergeIntoZone,
  newZoneId,
  restoreZones,
  sameZones,
  withoutZones,
  type ZoneAnchor,
  type ZoneCornerRef,
  type ZonePoint,
  type ZonePolygon,
} from "@/lib/map/zone";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";
import { cn } from "@/lib/utils";

const DEFAULT_BRUSH = 7;

/**
 * The editor opens in Pan, not Brush. Opening armed means the first drag to
 * look around is a stroke hundreds of cells wide, and a Free stroke over free
 * space is invisible, so nobody thinks to undo it. Painting costs an explicit
 * arm instead; every Draw change also lands on Pan (see DrawKind). Right- and
 * middle-drag and Space pan whatever the tool.
 */
const DEFAULT_TOOL: EditTool = "pan";

/**
 * Waypoint mode opens in Pan too: otherwise the first drag stages a draft
 * (panel, name field and all) that only Escape gets out of.
 */
const DEFAULT_VERTEX_TOOL: VertexTool = "pan";

/**
 * Zone mode opens in Pan as well. A stray corner is cheap, but resting on Pan
 * is what lets the editor dim the map and ask which tool — the one place a
 * zone tool is explained.
 */
const DEFAULT_ZONE_TOOL: ZoneTool = "pan";

/**
 * Loads the map and shows the guard states; EditorSurface does the editing.
 * The split means everything tied to one loaded grid (the undo history, whose
 * patches index into a specific buffer) starts fresh by remounting, not by
 * clearing state in an effect.
 */
export function MapGridEditor({
  name,
  initialMode = "grid",
  onDirtyChange,
}: {
  name: string;
  /**
   * The mode to open in: grid, unless a link asks for waypoints (the task
   * editor's does). The tool still opens on Pan.
   */
  initialMode?: EditMode;
  /** Lets the page guard its back button; see the page. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { session, status, error } = useMapGrid(name);
  /**
   * Loaded here, not in EditorSurface: the surface remounts on every grid
   * reload, but waypoints belong to the map and would be refetched for no
   * reason. Handed down as the starting list; a save writes what landed into
   * the cache, so a remount starts from what the robot holds.
   */
  const vertices = useMapVertices(name);
  /** The zones, for the same reason. */
  const keepout = useMapKeepout(name);

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

  // Wait for zones and waypoints as well as the grid: an answer arriving after
  // edits began would have to be merged. A failed read doesn't wait (see
  // `initialZones`).
  if (!session || keepout.status === "loading" || vertices.status === "loading") {
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
      initialVertices={vertices.status === "ok" ? vertices.vertices : null}
      verticesError={vertices.error}
      saveVertices={vertices.save}
      initialZones={keepout.zones}
      zonesError={keepout.error}
      initialMode={initialMode}
      onDirtyChange={onDirtyChange}
    />
  );
}

/**
 * The editor shell: tool state, undo, shortcuts and the save flow.
 * GridCanvas owns the buffer, mirror and view; they meet at `GridSession`
 * (lib/map/session.ts).
 */
function EditorSurface({
  session,
  initialVertices,
  verticesError,
  saveVertices,
  initialZones,
  zonesError,
  initialMode,
  onDirtyChange,
}: {
  session: GridSession;
  /**
   * The map's waypoints as saved, or null if unreadable — which locks the
   * layer: Save sends a diff, and a diff from "unknown" means nothing.
   */
  initialVertices: MapVertex[] | null;
  verticesError: string | null;
  saveVertices: UseMapVertices["save"];
  /**
   * The map's zones as saved, or null if unreadable — which locks the layer:
   * a save is the whole list, so drawing over "unknown" would erase every zone
   * the robot holds. The floor plan stays editable.
   */
  initialZones: ZonePolygon[] | null;
  zonesError: string | null;
  initialMode: EditMode;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  /**
   * The Draw strip's choice, which `mode` and `value` follow (editStateOf).
   * Nothing, unless a link asked for waypoints.
   */
  const [drawKind, setDrawKind] = React.useState<DrawKind | null>(
    initialMode === "vertex" ? "waypoint" : null,
  );
  const [mode, setMode] = React.useState<EditMode>(initialMode);
  const [tool, setTool] = React.useState<EditTool>(DEFAULT_TOOL);
  const [vertexTool, setVertexTool] = React.useState<VertexTool>(DEFAULT_VERTEX_TOOL);
  const [zoneTool, setZoneTool] = React.useState<ZoneTool>(DEFAULT_ZONE_TOOL);
  // Free by default: erasing phantom obstacles is why this screen exists.
  const [value, setValue] = React.useState<GridValue>(FREE);
  const [brush, setBrush] = React.useState<number>(DEFAULT_BRUSH);

  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [save, setSaveState] = React.useState<SaveState>({ kind: "idle" });

  /**
   * Bumped by every edit. `fetch` copies the body at the call, so a stroke
   * painted mid-request isn't on disk — clearing `dirty` on that response
   * would mark it saved.
   */
  const revisionRef = React.useRef(0);

  const [hover, setHover] = React.useState<CellProbe | null>(null);
  const [scale, setScale] = React.useState(1);
  const [fitNonce, setFitNonce] = React.useState(0);
  const [spacePan, setSpacePan] = React.useState(false);

  /** Strokes and waypoint edits, in the order made; see lib/map/history.ts. */
  const historyRef = React.useRef(createUndoStack<EditorEdit>(editBytes));

  /*
   * Waypoints are staged like the zones: Create, Apply and Delete change
   * `vertexList`, and Save writes its diff from `savedVertices`
   * (lib/map/vertex-stage.ts), feeding `verticesDirty`.
   */
  const verticesLocked = initialVertices === null;
  const [vertexList, setVertexList] = React.useState<MapVertex[]>(initialVertices ?? []);
  const [savedVertices, setSavedVertices] = React.useState<MapVertex[]>(
    initialVertices ?? [],
  );
  const verticesDirty = !verticesLocked && !sameVertices(savedVertices, vertexList);
  /** The last waypoint save, kept apart for `zoneSave`'s reason. */
  const [vertexSave, setVertexSave] = React.useState<SaveState>({ kind: "idle" });
  const vertexWriting = vertexSave.kind === "saving";
  /** Numbers the local ids of waypoints placed here and not yet saved. */
  const localSerialRef = React.useRef(0);
  const [vertexType, setVertexType] = React.useState<VertexType>(DEFAULT_VERTEX_TYPE);
  const [draft, setDraft] = React.useState<PlanarPose | null>(null);
  /**
   * Every highlighted vertex. A list (the band yields sets) rather than a Set
   * (GridCanvas is memoized and needs a stable identity). The form opens only
   * at exactly one.
   */
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  /**
   * A re-aim of the selected vertex, awaiting Save — heading only. Moving a
   * stop is the dashboard's job, where it is drawn over the live scan that
   * can show it half inside a wall.
   */
  const [stagedPose, setStagedPose] = React.useState<PlanarPose | null>(null);
  /** The last point the shell asked the canvas to centre on; see GridCanvas.focus. */
  const [focus, setFocus] = React.useState<{ x: number; y: number } | null>(null);

  /*
   * Zones wait for Save rather than writing through: the endpoint takes the
   * whole list and the planner reloads on each write, so a PUT per dragged
   * corner would reload it dozens of times. `zonesDirty` measures against
   * `savedZones`. Only finished zones are saved; a shape in flight stays.
   */
  const zonesLocked = initialZones === null;
  const [zones, setZones] = React.useState<ZonePolygon[]>(initialZones ?? []);
  const [savedZones, setSavedZones] = React.useState<ZonePolygon[]>(initialZones ?? []);
  const zonesDirty = !zonesLocked && !sameZones(zones, savedZones);
  /** The last zone save — separate from the grid's, since either can fail alone. */
  const [zoneSave, setZoneSave] = React.useState<SaveState>({ kind: "idle" });
  /** Which press `zoneSave` reports on: Save, or a Remove, which writes at once. */
  const [zoneAction, setZoneAction] = React.useState<"save" | "remove">("save");
  /**
   * One zone write at a time: Save and Remove each send a whole list the
   * other didn't see, so the second to land would undo the first.
   */
  const zoneWriting = zoneSave.kind === "saving";
  // `mutate` alone (see useSaveMapGrid below); up here because Remove writes too.
  const { mutate: saveZones } = useSaveMapKeepout();
  const [zoneDraft, setZoneDraft] = React.useState<ZonePoint[]>([]);
  /**
   * The finished zone's corner the shape in flight is attached to. Kept
   * beside the draft, not in it: the draft holds a copy of the corner, which
   * goes stale once that corner is dragged.
   */
  const [zoneDraftAnchor, setZoneDraftAnchor] = React.useState<ZoneAnchor | null>(null);
  /** The zones Remove takes and whose corners drag; several by Shift-click or tap. */
  const [selectedZoneIds, setSelectedZoneIds] = React.useState<string[]>([]);

  /**
   * The robot's pose on this map, both drawn and what Use robot position
   * stages, so the two can't disagree. From the 1 Hz shared poll, memoised on
   * value (see useRobotMapPose for why not the 20 Hz socket).
   */
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(session.name);

  /**
   * Whether a job drives on this map: a write now would be picked up
   * mid-route. The card's Edit greys on the same lock, but a URL reaches any
   * map and a job can start after opening, so the editor asks itself. Only
   * writes stop — edits go on and are kept — and each write path checks too,
   * since a shortcut skips a greyed button.
   */
  const runLock = useMapRunLock(session.name);
  const writeLocked = runLock.locked;

  /** The rows Save would write; the panel marks them, since the canvas draws staged and stored alike. */
  const pendingVertexIds = React.useMemo(() => {
    if (verticesLocked) return new Set<string>();
    const plan = planVertexSave(savedVertices, vertexList);
    return new Set([
      ...plan.creates.map(({ localId }) => localId),
      ...plan.updates.map(({ id }) => id),
    ]);
  }, [savedVertices, vertexList, verticesLocked]);

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
      // Both directions land unarmed, or a mode toggle would bring back the
      // stray placement DEFAULT_VERTEX_TOOL exists to stop.
      setVertexTool(DEFAULT_VERTEX_TOOL);
      setZoneTool(DEFAULT_ZONE_TOOL);
      // A draft left staged in grid mode would have no panel to dismiss it.
      if (next === "grid") clearVertexEdit();
      // Likewise a shape in flight. Finished zones stay drawn, unselected,
      // since no other mode offers Remove.
      setZoneDraft([]);
      setZoneDraftAnchor(null);
      setSelectedZoneIds([]);
    },
    [clearVertexEdit],
  );

  /**
   * Arm a waypoint tool. Back to Pan also drops the selection or draft, by
   * request: Pan means "done with that one".
   */
  const chooseVertexTool = React.useCallback(
    (next: VertexTool) => {
      setVertexTool(next);
      if (next === "pan") clearVertexEdit();
    },
    [clearVertexEdit],
  );

  /** Arm a zone tool. Pan drops the shape in flight, as for waypoints. */
  const chooseZoneTool = React.useCallback((next: ZoneTool) => {
    setZoneTool(next);
    if (next === "pan") {
      setZoneDraft([]);
      setZoneDraftAnchor(null);
      setSelectedZoneIds([]);
    }
  }, []);

  /**
   * A corner on bare map drops the selection, so Remove can't target the
   * wrong shape — except for an anchored shape, whose zone stays lit.
   */
  const addZonePoint = React.useCallback(
    (point: ZonePoint) => {
      if (!zoneDraftAnchor) setSelectedZoneIds([]);
      setZoneDraft((draft) => [...draft, point]);
    },
    [zoneDraftAnchor],
  );

  /**
   * Attach the shape in flight to a finished zone's corner (as its start, or
   * its next corner). A copy joins the draft and the zone is selected to show
   * which one it will join. Reads the draft from the closure (closeZone's
   * reason).
   */
  const anchorZoneDraft = React.useCallback(
    (corner: ZoneCornerRef) => {
      if (corner.zoneId === null) return;
      const zone = zones.find((entry) => entry.id === corner.zoneId);
      const point = zone?.points[corner.index];
      if (!point) return;
      setZoneDraft([...zoneDraft, point]);
      setZoneDraftAnchor({ zoneId: corner.zoneId, index: corner.index, position: zoneDraft.length });
      setSelectedZoneIds([corner.zoneId]);
    },
    [zones, zoneDraft],
  );

  /**
   * End an anchored shape on another corner of its zone, replacing the edge
   * between them (mergeIntoZone). The zone stays selected. Reads the draft
   * from the closure (closeZone's reason).
   */
  const mergeZoneDraft = React.useCallback(
    (corner: ZoneCornerRef) => {
      const anchor = zoneDraftAnchor;
      if (!anchor || corner.zoneId !== anchor.zoneId) return;
      const zone = zones.find((entry) => entry.id === anchor.zoneId);
      if (!zone) return;
      const merged = mergeIntoZone(zone.points, zoneDraft, anchor, corner.index);
      if (!merged) return;
      setZones((current) =>
        current.map((entry) => (entry.id === anchor.zoneId ? { ...entry, points: merged } : entry)),
      );
      setZoneDraft([]);
      setZoneDraftAnchor(null);
      setSelectedZoneIds([anchor.zoneId]);
    },
    [zones, zoneDraft, zoneDraftAnchor],
  );

  /**
   * A dragged corner, of the shape in flight (`zoneId` null) or a finished
   * zone. Out of range is a no-op, not an append: a Done or Remove mid-drag
   * may have removed it.
   */
  const moveZoneCorner = React.useCallback(({ zoneId, index }: ZoneCornerRef, point: ZonePoint) => {
    const moved = (points: ZonePoint[]) =>
      index < points.length ? points.map((corner, i) => (i === index ? point : corner)) : points;
    if (zoneId === null) {
      setZoneDraft(moved);
      return;
    }
    setZones((current) =>
      current.map((zone) => (zone.id === zoneId ? { ...zone, points: moved(zone.points) } : zone)),
    );
  }, []);

  /** A click inside a zone: select it, or toggle with Shift (a tap on a phone). */
  const pickZone = React.useCallback((id: string, additive: boolean) => {
    setSelectedZoneIds((current) => {
      if (!additive) return [id];
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  }, []);

  /**
   * Remove the selected zones, on the robot at once (no Save). An anchored
   * shape on one goes too.
   *
   * Sends the *last saved* list minus these, not the screen's: a remove only
   * deletes, so unsaved zone edits stay for Save. Never-saved zones send
   * nothing. Taken off screen before the answer (a reload can take seconds)
   * and put back on a refusal, so the map never hides a zone the planner keeps.
   */
  const removeZone = React.useCallback(() => {
    if (selectedZoneIds.length === 0 || zoneWriting || writeLocked) return;
    const ids = selectedZoneIds;
    const { removed } = withoutZones(zones, ids);
    setZones((current) => withoutZones(current, ids).kept);
    setSelectedZoneIds([]);
    if (zoneDraftAnchor && ids.includes(zoneDraftAnchor.zoneId)) {
      setZoneDraft([]);
      setZoneDraftAnchor(null);
    }

    const remote = withoutZones(savedZones, ids);
    if (remote.removed.length === 0) return;
    setZoneAction("remove");
    setZoneSave({ kind: "saving" });
    saveZones(
      { name: session.name, zones: remote.kept },
      {
        onSuccess: (result) => {
          setSavedZones((current) => withoutZones(current, ids).kept);
          setZoneSave({
            kind: "saved",
            active: result.active,
            reloaded: result.reloaded,
            message: result.message,
          });
        },
        onError: (cause) => {
          setZones((current) => restoreZones(current, removed));
          setZoneSave({ kind: "failed", message: cause.message });
        },
      },
    );
  }, [selectedZoneIds, zoneWriting, writeLocked, zones, zoneDraftAnchor, savedZones, saveZones, session.name]);

  const dropZoneDraft = React.useCallback(() => {
    setZoneDraft([]);
    setZoneDraftAnchor(null);
  }, []);

  /** Done and Enter close only an unanchored shape; an anchored one ends on its zone. */
  const canClose = zoneDraftAnchor === null && canCloseZone(zoneDraft);

  /**
   * Close the shape in flight into a zone. Reads `zoneDraft` from the closure
   * rather than nesting `setZones` in a `setZoneDraft` updater: StrictMode runs
   * updaters twice, which would add the zone twice.
   */
  const closeZone = React.useCallback(() => {
    if (!canClose) return;
    setZones((current) => [...current, { id: newZoneId(current), points: zoneDraft }]);
    setZoneDraft([]);
  }, [canClose, zoneDraft]);

  /**
   * Put a Draw choice down, or pick it up (`null`). Lands on Pan in both tool
   * axes (DEFAULT_TOOL's reason). Via changeMode, so a staged draft drops.
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

  /** Make `id` the panel's subject; a draft or staged re-aim doesn't survive the change. */
  const selectVertex = React.useCallback(
    (id: string | null) => {
      clearVertexEdit();
      setSelectedIds(id ? [id] : []);
    },
    [clearVertexEdit],
  );

  /**
   * Shift-click on a marker: add or drop it — for stops a band can't catch
   * alone. Toggling down to one simply reopens the form.
   */
  const toggleVertex = React.useCallback(
    (id: string) => {
      setDraft(null);
      setStagedPose(null);
      setSelectedIds((current) =>
        current.includes(id)
          ? current.filter((other) => other !== id)
          : [...current, id],
      );
    },
    [],
  );

  /** A finished band. `additive` is Shift: union rather than replace. */
  const selectMany = React.useCallback(
    (ids: string[], additive: boolean) => {
      setDraft(null);
      setStagedPose(null);
      setSelectedIds((current) =>
        additive
          ? [...current, ...ids.filter((id) => !current.includes(id))]
          : ids,
      );
    },
    [],
  );

  const handleVertexGesture = React.useCallback(
    ({ id, pose }: VertexGesture) => {
      if (id !== null) {
        // The canvas echoes the stored heading on a click inside the deadzone,
        // so a plain select doesn't arm Save.
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
   * Stage a draft where the robot stands, and centre on it. A snapshot, not a
   * binding, or the draft would creep while being named. Clears like a press
   * on the map, so it works with a vertex open.
   */
  const placeAtRobot = React.useCallback(() => {
    if (!robotPose) return;
    setSelectedIds([]);
    setStagedPose(null);
    setDraft(robotPose);
    // A fresh object every press: identity triggers the canvas.
    setFocus({ x: robotPose.x, y: robotPose.y });
  }, [robotPose]);

  /**
   * Make `next` the staged list as one undo step. A save's rebase doesn't go
   * through here: it changes ids, not anything the operator did.
   */
  const recordWaypoints = React.useCallback(
    (next: MapVertex[]) => {
      pushPatch(historyRef.current, { kind: "waypoints", before: vertexList, after: next });
      setVertexList(next);
      setCanUndo(true);
      setCanRedo(false);
    },
    [vertexList],
  );

  /** Stage the draft as a waypoint; Save sends it. Stages even under a run lock. */
  const createFromDraft = React.useCallback(
    (name: string, type: VertexType) => {
      if (!draft || verticesLocked) return;
      localSerialRef.current += 1;
      const staged: MapVertex = {
        id: localVertexId(localSerialRef.current),
        map_name: session.name,
        name,
        type,
        x: draft.x,
        y: draft.y,
        theta: draft.theta,
        // The floor plan has no floors: a waypoint placed on it is on the
        // ground floor. Upper floors are placed on the dashboard's 3D map.
        z: 0,
      };
      recordWaypoints([...vertexList, staged]);
      // Cleared rather than selected: placing a run of stops is the common case.
      setDraft(null);
    },
    [draft, verticesLocked, session.name, vertexList, recordWaypoints],
  );

  const applySelected = React.useCallback(
    (changes: VertexChanges) => {
      if (!selectedId || verticesLocked) return;
      recordWaypoints(
        vertexList.map((vertex) => (vertex.id === selectedId ? { ...vertex, ...changes } : vertex)),
      );
      setStagedPose(null);
    },
    [selectedId, verticesLocked, vertexList, recordWaypoints],
  );

  /**
   * Take everything selected off screen. A stored one is deleted on Save; an
   * unsaved one simply never gets sent. Undo brings either back.
   */
  const deleteSelected = React.useCallback(() => {
    if (verticesLocked) return;
    const gone = new Set(selectedIds);
    recordWaypoints(vertexList.filter((vertex) => !gone.has(vertex.id)));
    clearVertexEdit();
  }, [selectedIds, clearVertexEdit, verticesLocked, vertexList, recordWaypoints]);

  /** Anything Save would write: cells, zones, waypoints, or any mix. */
  const anyDirty = dirty || zonesDirty || verticesDirty;

  React.useEffect(() => {
    onDirtyChange?.(anyDirty);
  }, [anyDirty, onDirtyChange]);

  const commitPatch = React.useCallback((patch: GridPatch) => {
    pushPatch(historyRef.current, { kind: "grid", patch });
    setCanUndo(true);
    setCanRedo(false);
    setDirty(true);
    revisionRef.current += 1;
    // The note described the buffer as saved; "Saved" beside a lit Unsaved is
    // the one confusing pair this can show.
    setSaveState({ kind: "idle" });
  }, []);

  const step = React.useCallback(
    (direction: "undo" | "redo") => {
      const stack = historyRef.current;
      const edit = direction === "undo" ? popUndo(stack) : popRedo(stack);
      if (!edit) return;
      setCanUndo(stack.undo.length > 0);
      setCanRedo(stack.redo.length > 0);

      const side = direction === "undo" ? "before" : "after";
      if (edit.kind === "waypoints") {
        // Whatever is open in the panel drops: its row may have changed, and
        // Apply would write the old values back.
        setVertexList([...edit[side]]);
        clearVertexEdit();
        return;
      }
      applyPatch(session.grid, edit.patch, side);
      session.repaint?.(edit.patch.bounds);
      // Still dirty: the stack is byte-capped, so an empty one doesn't prove
      // the buffer matches what was loaded.
      setDirty(true);
      revisionRef.current += 1;
      setSaveState({ kind: "idle" });
    },
    [session, clearVertexEdit],
  );

  const undo = React.useCallback(() => step("undo"), [step]);
  const redo = React.useCallback(() => step("redo"), [step]);
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);

  // `mutate` alone: bound once per observer, so `onSave` keeps its identity.
  const { mutate: saveGrid } = useSaveMapGrid();

  /**
   * Write whatever changed — buffer, zones, waypoints — side by side, since
   * none's outcome says anything about another's; each has a note.
   *
   * The grid isn't refetched (useSaveMapGrid says why). Its outcome lives in
   * `save` rather than on the mutation because "saved" is only true of the
   * bytes as of `sent`; a stroke since puts it back to idle.
   */
  const onSave = React.useCallback(() => {
    if (writeLocked) return;
    if (zonesDirty) {
      // The list as of the press becomes `savedZones`, so a corner dragged
      // mid-request is still unsaved after, by comparison.
      const sent = zones;
      setZoneAction("save");
      setZoneSave({ kind: "saving" });
      saveZones(
        { name: session.name, zones: sent },
        {
          onSuccess: (result) => {
            setSavedZones(sent);
            setZoneSave({
              kind: "saved",
              active: result.active,
              reloaded: result.reloaded,
              message: result.message,
            });
          },
          onError: (cause) => setZoneSave({ kind: "failed", message: cause.message }),
        },
      );
    }
    if (verticesDirty && !vertexWriting) {
      // The plan as of the press; rebaseVertices folds in what landed, so an
      // edit mid-request stays unsaved.
      setVertexSave({ kind: "saving" });
      void saveVertices(planVertexSave(savedVertices, vertexList)).then(({ landed, failure }) => {
        const { ids } = rebaseVertices([], [], landed);
        setSavedVertices((current) => rebaseVertices(current, [], landed).saved);
        setVertexList((current) => rebaseVertices([], current, landed).working);
        setSelectedIds((current) => current.map((id) => ids.get(id) ?? id));
        remapWaypointIds(historyRef.current, ids);
        setVertexSave(
          failure
            ? { kind: "failed", message: vertexSaveFailure(landed, failure) }
            : // A waypoint reloads nothing, so the note is the plain one.
              { kind: "saved", active: false, reloaded: false, message: vertexSaveSummary(landed) },
        );
      });
    }
    if (!dirty) return;

    const sent = revisionRef.current;
    setSaveState({ kind: "saving" });

    saveGrid(
      { name: session.name, grid: session.grid },
      {
        onSuccess: (result) => {
          // Only the bytes as of `sent` are on disk.
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
  }, [
    dirty,
    saveGrid,
    saveZones,
    session,
    zones,
    zonesDirty,
    writeLocked,
    verticesDirty,
    vertexWriting,
    saveVertices,
    savedVertices,
    vertexList,
  ]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * Escape sits above the typing guard: a staged draft autofocuses the
       * name field, and that is exactly when Escape is pressed ("didn't mean
       * that"). One press drops what's staged and disarms every tool.
       *
       * Except a zone shape in flight (or a selected zone): Escape drops it but
       * keeps Shape armed, since five corners are worth redrawing at once. The
       * next press puts the choice down.
       */
      if (event.key === "Escape") {
        event.preventDefault();
        if (zoneDraft.length) {
          dropZoneDraft();
          return;
        }
        if (selectedZoneIds.length) {
          setSelectedZoneIds([]);
          return;
        }
        // Putting the Draw choice down drops a draft and lands every axis on Pan.
        chooseDraw(null);
        return;
      }

      // `0` and Space would eat typing in the name field; Ctrl+Z falls through
      // to the field's native undo.
      if (isTypingTarget(event.target)) return;

      // Below the guard: Enter in the waypoint form submits it, and no form
      // is mounted in zone mode.
      if (event.key === "Enter" && canClose) {
        event.preventDefault();
        closeZone();
        return;
      }
      // Below the guard: Backspace in a field is editing.
      if ((event.key === "Delete" || event.key === "Backspace") && selectedZoneIds.length) {
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
        // In case the layout ever gains a scrolling ancestor.
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
    // Without this a window blur mid-Space leaves the editor stuck panning.
    const onBlur = () => setSpacePan(false);

    // On window, so shortcuts work without clicking the canvas first.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
    // Re-subscribing per corner is harmless: no gesture depends on these.
  }, [undo, redo, fit, chooseDraw, zoneDraft, dropZoneDraft, canClose, closeZone, selectedZoneIds, removeZone]);

  /**
   * Reload and tab close only: the App Router can't block in-app navigation,
   * so the page's back button confirms itself.
   */
  React.useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyDirty]);

  /**
   * Forbidden zone chosen, no tool armed: the map dims and asks, since "Shape"
   * is new to the operator and the dim says the map is waiting, not broken.
   */
  const zoneUnarmed = drawKind === "zone" && zoneTool === "pan";

  const vertexPanelProps = {
    vertices: vertexList,
    status: verticesLocked ? ("error" as const) : ("ok" as const),
    error: verticesLocked
      ? `Waypoints could not be loaded, so they cannot be edited here.${verticesError ? ` ${verticesError}` : ""}`
      : null,
    // Held only while a save is out: a Create beside a spinner reads as sending.
    busy: vertexWriting,
    locked: verticesLocked,
    pendingIds: pendingVertexIds,
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
    // A draft and a selection are mutually exclusive, so clearing the edit is
    // "drop the draft" and also the band's Clear.
    onCancelDraft: clearVertexEdit,
    onClearSelection: clearVertexEdit,
    onCreate: createFromDraft,
    onApply: applySelected,
    onDelete: deleteSelected,
  };

  return (
    // For the e2e suite only, as attributes so they can't become on-screen
    // diagnostics: data-zoom (scale %) proves a pinch zoomed, data-zones
    // (finished count) proves a shape closed.
    <div
      className="relative h-full w-full"
      data-zoom={Math.round(scale * 100)}
      data-zones={zones.length}
    >
      <ViewportBoundary>
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
          zoneDraftAnchor={zoneDraftAnchor}
          onZonePoint={addZonePoint}
          onZoneAnchor={anchorZoneDraft}
          onZoneMerge={mergeZoneDraft}
          onZoneClose={closeZone}
          onZoneCornerMove={moveZoneCorner}
          selectedZoneIds={selectedZoneIds}
          onZonePick={pickZone}
        />
      </ViewportBoundary>

      {/* The wash comes before the strips, so DOM order stacks them above it.
        * Pointer-transparent so the dimmed map still pans; grey because the
        * grid ignores the theme (lib/map/draw.ts). */}
      {zoneUnarmed && (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/25" />
      )}

      {/* One row across the top, Editor left and Draw right, wrapping on a
        * phone. Pointer-transparent; full height so the waypoint panel can
        * drop to the bottom on a phone. */}
      <div className="pointer-events-none absolute inset-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <EditorToolBar
            className="pointer-events-auto"
            onFit={fit}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            dirty={anyDirty}
            saving={save.kind === "saving" || zoneWriting || vertexWriting}
            writeLock={runLock.reason}
            onSave={onSave}
            drawKind={drawKind}
            tool={tool}
            onToolChange={setTool}
            vertexTool={vertexTool}
            onVertexToolChange={chooseVertexTool}
            zoneTool={zoneTool}
            onZoneToolChange={chooseZoneTool}
            canCloseZone={canClose}
            onCloseZone={closeZone}
            selectedZones={selectedZoneIds.length}
            zoneWriting={zoneWriting}
            removingZones={zoneWriting && zoneAction === "remove"}
            onRemoveZone={removeZone}
            brush={brush}
            onBrushChange={setBrush}
          />
          <EditorDrawBar
            className="pointer-events-auto"
            drawKind={drawKind}
            onDrawKindChange={chooseDraw}
            zonesLocked={zonesLocked}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
          />
        </div>

        {/* Under each strip, what it reports into: the save note under Save,
          * the waypoint panel under Draw — on a phone at the canvas bottom, by
          * CSS, so there is one form. The panel mounts only in waypoint mode:
          * leaving it already clears its state, and `vertexType`, the one
          * thing worth keeping, lives up here. */}
        <div className="flex min-h-0 items-start justify-between gap-2">
          {/* The zone hint sits under the strip holding Shape, the tool it asks
            * for, and outside the aria-hidden wash so its status is heard. */}
          <div className="flex flex-col items-start gap-2">
            {zoneUnarmed && <ArmedHint tone="cmd">Select the shape to work with</ArmedHint>}
            {/* Above the save notes: it is why Save is greyed. A status, not an
              * alert — nothing failed, and it may stay for a whole run. */}
            {runLock.reason && (
              <p
                role="status"
                className={cn(overlayPanel, "pointer-events-auto max-w-72 px-2 py-1.5 text-[11px] leading-tight", TONE_TEXT.caution)}
              >
                <span className="font-medium">Read-only.</span> {runLock.reason}
              </p>
            )}
            <SaveNote save={save} className="pointer-events-auto max-w-72" />
            {/* A save's note only while still true of the zones on screen; a
              * remove's note and a failure stay, since edits don't change them. */}
            {(zoneAction === "remove" || zoneSave.kind === "failed" || !zonesDirty) && (
              <SaveNote
                save={zoneSave}
                subject={zoneAction === "remove" ? "zonesRemoved" : "zones"}
                className="pointer-events-auto max-w-72"
              />
            )}
            {/* Same rule as the zones' note. */}
            {(vertexSave.kind === "failed" || !verticesDirty) && (
              <SaveNote
                save={vertexSave}
                subject="waypoints"
                className="pointer-events-auto max-w-72"
              />
            )}
            {zonesLocked && (
              <p role="alert" className={cn(overlayPanel, "pointer-events-auto max-w-72 px-2 py-1.5 text-[11px] leading-tight", TONE_TEXT.warn)}>
                Forbidden zones could not be loaded, so they cannot be edited here.
                {zonesError && <span className="mt-0.5 block text-muted-foreground">{zonesError}</span>}
              </p>
            )}
          </div>
          {mode === "vertex" && (
            <VertexPanel
              className="pointer-events-auto ml-auto max-h-full min-h-0 overflow-y-auto max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[45%] max-sm:w-auto"
              {...vertexPanelProps}
            />
          )}
        </div>
      </div>

      {/* Driving to a pose for Use robot position is the masthead's drive
        * panel; it can't eat these shortcuts (disarmed by default, and WASD/QE
        * doesn't overlap Space / 0 / Ctrl+Z). */}

      {/* Hidden on a phone or a short screen: the readout follows a hover, and
        * the phone's bottom edge is the waypoint panel's. */}
      <GridStatus
        className="absolute bottom-3 left-3 hidden sm:block [@media(max-height:480px)]:hidden"
        meta={session.meta}
        hover={hover}
      />
    </div>
  );
}
