"use client";

import * as React from "react";

import { ViewportBoundary } from "@/components/console/fault-boundary";
import { FloorPicker } from "@/components/console/floor-picker";
import { overlayPanel } from "@/components/console/instrument";
import { VertexCreateDialog } from "@/components/dashboard/vertex-create-dialog";
import { type TypedPose, VertexMoveDialog } from "@/components/dashboard/vertex-move-dialog";
import { VertexPlaceControl } from "@/components/dashboard/vertex-place-control";
import { Map3dCanvas, type Map3dTool } from "@/components/maps/map-3d-canvas";
import { Map3dWaypointPanel } from "@/components/maps/map-3d-waypoint-panel";
import {
  Map3dDrawBar,
  Map3dToolBar,
  type Map3dDrawKind,
} from "@/components/maps/map-3d-toolbar";
import { useMapFloors } from "@/hooks/use-map-floors";
import { EditorNotice } from "@/components/maps/editor-notice";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { useMapKeepout } from "@/hooks/use-map-keepout";
import { useUndoHistory } from "@/hooks/use-undo-history";
import { useViewCommands } from "@/hooks/use-view-commands";
import { useWaypointPlacement } from "@/hooks/use-waypoint-placement";
import { useZoneEditing } from "@/hooks/use-zone-editing";
import { useMounted } from "@/hooks/use-mounted";
import { useMapVertices, type UseMapVertices } from "@/hooks/use-map-vertices";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapOctomapEdits } from "@/hooks/use-map-octomap-edits";
import { useSaveMapOctomapEdits } from "@/hooks/use-map-actions";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useMapEntry } from "@/hooks/use-maps";
import { useFloorBand } from "@/hooks/use-floor-band";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { drawnGround, floorBands } from "@/lib/map/floors";
import {
  bandForHeights,
  floorHeightIn,
  fullBand,
  kzToMetres,
  metresToKz,
} from "@/lib/map/ground";
import {
  DEFAULT_BRUSH_RADIUS_M,
  applyGroundPatch,
  cellsFor,
  createGroundSession,
  fillReach,
  fromFillKeys,
  groundPatchBytes,
  sameEdits,
  setGroundBand,
  toFillKeys,
  type GroundEdits,
  type GroundPatch,
} from "@/lib/map/ground-fill";
import {
  localVertexId,
  planVertexSave,
  rebaseVertices,
  sameVertices,
  vertexSaveFailure,
  vertexSaveSummary,
} from "@/lib/map/vertex-stage";
import { floorGroundOf, placedGround, robotGround } from "@/lib/map/waypoint-ground";
import {
  canCloseZone,
  removedZones,
  zoneBandAround,
  zonesBytes,
  type ZoneCornerRef,
} from "@/lib/map/zone";
import type { ZoneCommit } from "@/lib/map/zone-session";
import { isTypingTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType, ZonePoint, ZonePolygon } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PlanarPose } from "@/lib/types/robot";

/** One empty list for every render before the zones are read, so the canvas does not rebuild. */
const NO_ZONES: ZonePolygon[] = [];

/**
 * The map editor: the 3D map in 3D, and a brush that paints floor
 * into the holes the lidar never saw. A save records the patches on the
 * robot; the robot's own tool writes them into the tree, so the note after
 * a save says they wait to be applied.
 *
 * It is also where a map gets its waypoints. They are staged
 * (lib/map/vertex-stage.ts): placed, moved and deleted on screen, a run of
 * them, and sent by Save. Writing each as it was
 * placed, the dashboard's flow, made laying out a site a save per stop.
 * With Waypoint chosen, a list names every stop (2026-10-24, by request: an
 * operator naming the next one could not tell which names were taken), and
 * its rows and Select's taps make a set one Delete takes.
 *
 * And its forbidden zones (2026-10-23): the robot's 3D planner reads them
 * from keepout.json, each zone optionally banded to the floor it forbids. A
 * zone drawn with a floor picked on a map of several storeys forbids that
 * floor only; with none picked, or on a map of one, it forbids every floor.
 * Drawn, merged and moved on screen and sent by Save, beside the patches;
 * Remove is sent at once.
 *
 * Loads the tree (shared with the dashboard's layer) and the saved patches,
 * and mounts the surface only once both are in: a record arriving after
 * strokes began would have to be merged.
 */
export function Map3dEditor({
  name,
  openOnWaypoint = false,
  onDirtyChange,
}: {
  name: string;
  /** Arm the Waypoint tool on opening, for a link that came to place waypoints. */
  openOnWaypoint?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const entry = useMapEntry(name);
  const tree = useMapOctomap(name);
  const edits = useMapOctomapEdits(name);
  /**
   * Read here: the surface remounts on a new tree, and its staged list
   * starts from what the robot holds.
   */
  const vertices = useMapVertices(name);
  // The status strip reads the catalogue too, so the entry can be cached
  // before this boundary hydrates; a guard drawn from it then would not be
  // the "Loading" the server drew without one.
  const mounted = useMounted();

  if (mounted && entry && entry.octomap_status !== "ok") {
    return (
      <EditorNotice title="Cannot open the 3D map">
        {entry.octomap_status === "converting"
          ? "The robot is still building this map's 3D map. Come back once it has finished."
          : entry.octomap_status === "failed"
            ? (entry.octomap_error ?? "The robot could not build this map's 3D map.")
            : "This map has no 3D map, so there is nothing to edit."}
      </EditorNotice>
    );
  }
  if (tree.status === "error") {
    return <EditorNotice title="Cannot open the 3D map">{tree.error}</EditorNotice>;
  }
  if (edits.status === "error") {
    // Painting over an unread record would erase it on the first Save.
    return (
      <EditorNotice title="Cannot open the 3D map">
        {edits.error ?? "The saved patches could not be read."}
      </EditorNotice>
    );
  }
  // Wait for the waypoints too: a list arriving after placing began would
  // have to be merged. A failed read does not wait; it locks them instead.
  if (!tree.voxels || edits.fillKey === null || vertices.status === "loading") {
    return (
      <p className="instrument-label flex h-full items-center justify-center text-muted-foreground">
        Loading {name}…
      </p>
    );
  }

  return (
    <Map3dSurface
      key={`${name}/${entry?.octomap_version ?? ""}`}
      name={name}
      voxels={tree.voxels}
      initialFillKey={edits.fillKey}
      initialVertices={vertices.status === "ok" ? vertices.vertices : null}
      verticesError={vertices.error}
      saveVertices={vertices.save}
      openOnWaypoint={openOnWaypoint}
      onDirtyChange={onDirtyChange}
    />
  );
}

type SaveNote =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string };

/**
 * One undo step: a brush stroke's patch, or a finished zone edit as the
 * list stood either side of it. The waypoints have no undo yet.
 */
type EditorEntry =
  | { kind: "patch"; patch: GroundPatch }
  | ({ kind: "zones" } & ZoneCommit);

const editorEntryBytes = (entry: EditorEntry): number =>
  entry.kind === "patch"
    ? groundPatchBytes(entry.patch)
    : zonesBytes(entry.before) + zonesBytes(entry.after);

/**
 * The editor shell: tool state, the undo stack, shortcuts and the save flow.
 * The canvas owns the scene and the camera; they meet at the session
 * (lib/map/ground-fill.ts), which is mutable and never in React state.
 */
function Map3dSurface({
  name,
  voxels,
  initialFillKey,
  initialVertices,
  verticesError,
  saveVertices,
  openOnWaypoint,
  onDirtyChange,
}: {
  name: string;
  voxels: OccupiedVoxels;
  initialFillKey: number[][];
  /**
   * The map's waypoints as saved, or null if unreadable, which locks them:
   * Save sends a diff, and a diff from "unknown" means nothing.
   */
  initialVertices: MapVertex[] | null;
  verticesError: string | null;
  saveVertices: UseMapVertices["save"];
  openOnWaypoint: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [session] = React.useState(() => {
    const { edits } = fromFillKeys(initialFillKey, voxels);
    return createGroundSession(voxels, edits);
  });
  /** Patches in the record that lie outside this tree: another save's. */
  const skipped = React.useMemo(
    () => fromFillKeys(initialFillKey, voxels).skipped,
    [initialFillKey, voxels],
  );

  /**
   * What a press works on, chosen in the Draw list; the tools offered
   * follow it. A link that came to place
   * waypoints opens on Waypoint.
   */
  const [drawKind, setDrawKind] = React.useState<Map3dDrawKind | null>(
    openOnWaypoint ? "waypoint" : null,
  );
  const [tool, setTool] = React.useState<Map3dTool>("pan");
  /** The Place armed is Add charger's: the stops it places are Chargers. */
  const [placingCharger, setPlacingCharger] = React.useState(false);
  /**
   * A link's ask to open on Waypoint, held until the run lock first reads
   * clear rather than armed at once: on a fresh load the job list may not
   * have answered yet, and the lock fails closed until it has, which would
   * disarm the tool as soon as it was set. Any tool picked drops the ask.
   */
  const [waypointAsked, setWaypointAsked] = React.useState(openOnWaypoint);
  /** Moves on every change to the patches outside a stroke, which the canvas redraws on. */
  const [editsVersion, setEditsVersion] = React.useState(0);
  const [radiusM, setRadiusM] = React.useState<number>(DEFAULT_BRUSH_RADIUS_M);
  const [band, setBand] = React.useState(() => fullBand(voxels));
  const { fitNonce, zoomStep, fit, zoomIn, zoomOut } = useViewCommands();
  // On by default: the outlines are what make walls and steps readable.
  const [shading, setShading] = React.useState(true);
  const [count, setCount] = React.useState(session.edits.size);
  const [dirty, setDirty] = React.useState(false);
  const [note, setNote] = React.useState<SaveNote>({ kind: "idle" });
  /** The patches as last saved, compared against the session's for `dirty`. */
  const savedRef = React.useRef<GroundEdits>(new Map(session.edits));
  const {
    canUndo,
    canRedo,
    push: pushHistory,
    pop: popHistory,
  } = useUndoHistory<EditorEntry>(editorEntryBytes);

  const runLock = useMapRunLock(name);
  const { mutate: save } = useSaveMapOctomapEdits();
  const keepout = useMapKeepout(name);
  /**
   * The forbidden zones and the shape in flight, staged for Save
   * (hooks/use-zone-editing.ts). Null zones until the robot's list
   * is read: a save over an unread list would erase it.
   */
  const recordZones = React.useCallback(
    (commit: ZoneCommit) => pushHistory({ kind: "zones", ...commit }),
    [pushHistory],
  );
  const zoneEdit = useZoneEditing(name, keepout.zones, {
    clearNoteOnEdit: true,
    onCommit: recordZones,
  });
  const {
    addCorner: addZoneCorner,
    anchorOn: anchorZone,
    mergeOn: mergeZoneOn,
    moveCorner: moveZoneCorner,
    closeShape: closeZoneShape,
    dropShape: dropZoneShape,
    popCorner: popZoneCorner,
    remove: removeZones,
    endCornerDrag: endZoneCornerDrag,
    replace: replaceZones,
    save: saveZoneEdits,
  } = zoneEdit;
  const zones = zoneEdit.zones;
  const zonesDirty = zoneEdit.dirty;
  const zoneDraft = zoneEdit.draft;
  const zoneAnchor = zoneEdit.anchor;
  const zoneNote = zoneEdit.note;
  const { floors } = useMapFloors(name);
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(name);

  /*
   * Waypoints are staged like the zones and the patches: Create, Reposition
   * and Delete change `vertexList`, and Save writes its diff from
   * `savedVertices` (lib/map/vertex-stage.ts).
   */
  const verticesLocked = initialVertices === null;
  const [vertexList, setVertexList] = React.useState<MapVertex[]>(initialVertices ?? []);
  const [savedVertices, setSavedVertices] = React.useState<MapVertex[]>(initialVertices ?? []);
  const verticesDirty = !verticesLocked && !sameVertices(savedVertices, vertexList);
  const [vertexNote, setVertexNote] = React.useState<SaveNote>({ kind: "idle" });
  const vertexWriting = vertexNote.kind === "saving";
  /** Numbers the local ids of waypoints placed here and not yet saved. */
  const localSerialRef = React.useRef(0);
  /** The stop a re-place is carrying; Waypoint is armed while it is set. */
  const [moving, setMoving] = React.useState<MapVertex | null>(null);
  // A placed pose waiting for a name; staged only on Create. Detect charger
  // is offered only where `robotPose` is: on the map the robot is running.
  const placing = useWaypointPlacement({
    mapName: name,
    robotPose,
    voxels,
    bands: floorBands(floors),
  });
  const { placement } = placing;
  /** The stop a tap is asking about; null when the dialog is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
  /**
   * The stops a Delete takes, picked in the list or with Select. Held as ids
   * and read through the list, so a stop deleted another way drops out.
   */
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const selectedVertexIds = React.useMemo(() => {
    const kept = new Set(vertexList.map((vertex) => vertex.id));
    return selectedIds.filter((id) => kept.has(id));
  }, [selectedIds, vertexList]);

  /** The rows Save would write; the list marks them, since the map draws staged and stored alike. */
  const pendingVertexIds = React.useMemo(() => {
    if (verticesLocked) return new Set<string>();
    const plan = planVertexSave(savedVertices, vertexList);
    return new Set([
      ...plan.creates.map(({ localId }) => localId),
      ...plan.updates.map(({ id }) => id),
    ]);
  }, [savedVertices, vertexList, verticesLocked]);

  /** Why the waypoints cannot be placed or removed, or null. */
  const placeLock =
    runLock.reason ??
    (verticesLocked
      ? `The waypoints could not be read: ${verticesError ?? "unknown error"}`
      : null);

  if (waypointAsked && placeLock === null) {
    setWaypointAsked(false);
    setTool("waypoint");
  }

  // A lock arriving with Place or Remove armed disarms it, during render
  // rather than in an effect, so the next release cannot write onto a
  // read-only map. An open name dialog stays up instead: its Create greys and
  // the name survives.
  if (placeLock !== null && (tool === "waypoint" || tool === "move" || tool === "remove")) {
    setTool("pan");
    setMoving(null);
  }

  // Zones are written whole, so none may be until the list has been read:
  // a write over an unread list would erase the map's zones.
  const zoneLock =
    runLock.reason ??
    (keepout.status === "error"
      ? `The forbidden zones could not be read: ${keepout.error ?? "unknown error"}`
      : zones === null
        ? "Reading the forbidden zones…"
        : null);
  if (zoneLock !== null && (tool === "zone" || tool === "zoneRemove")) {
    setTool("pan");
    dropZoneShape();
  }

  /** Any tool change drops a re-place in hand, and a zone half drawn. */
  const changeTool = React.useCallback(
    (next: Map3dTool) => {
      setTool(next);
      setPlacingCharger(false);
      setWaypointAsked(false);
      if (next !== "waypoint") setMoving(null);
      if (next !== "zone") dropZoneShape();
    },
    [dropZoneShape],
  );


  /**
   * A new Draw choice starts on Pan, and
   * puts the selection down: off Waypoint there is no list to show it in.
   */
  const chooseDraw = React.useCallback(
    (kind: Map3dDrawKind | null) => {
      setDrawKind(kind);
      changeTool("pan");
      setSelectedIds([]);
    },
    [changeTool],
  );
  // Each floor's band in the tree's levels; a floor the tree does not reach
  // is not offered. Which one is picked is read back off the band, so a
  // slider moved by hand simply leaves every floor unpressed.
  const floorOptions = React.useMemo(
    () =>
      floorBands(floors).flatMap((floor) => {
        const levels = bandForHeights(voxels, floor.lo, floor.hi);
        return levels ? [{ ...floor, levels }] : [];
      }),
    [floors, voxels],
  );

  const res = voxels.res;
  const radius = cellsFor(radiusM, res);
  const reach = React.useMemo(() => fillReach(res), [res]);

  const refresh = React.useCallback(() => {
    setEditsVersion((n) => n + 1);
    setCount(session.edits.size);
    setDirty(!sameEdits(session.edits, savedRef.current));
    setNote({ kind: "idle" });
  }, [session]);

  // Unsaved zones and waypoints are unsaved work, and so is a zone half
  // drawn: all are lost on leaving.
  const unsaved = dirty || zonesDirty || verticesDirty || zoneDraft.length > 0;
  React.useEffect(() => {
    onDirtyChange?.(unsaved);
  }, [unsaved, onDirtyChange]);

  const commit = React.useCallback(
    (patch: GroundPatch) => {
      pushHistory({ kind: "patch", patch });
      refresh();
    },
    [refresh, pushHistory],
  );

  /** One history for the patches and the zones, so Undo takes the last edit of either. */
  const step = React.useCallback(
    (direction: "undo" | "redo") => {
      const entry = popHistory(direction);
      if (!entry) return;
      if (entry.kind === "zones") {
        replaceZones(direction === "undo" ? entry.before : entry.after);
        return;
      }
      applyGroundPatch(session.edits, entry.patch, direction === "undo" ? "before" : "after");
      refresh();
    },
    [session, refresh, popHistory, replaceZones],
  );
  const undo = React.useCallback(() => step("undo"), [step]);
  const redo = React.useCallback(() => step("redo"), [step]);

  /** Move the height band; the floors are rebuilt, and the canvas re-aims at them. */
  const changeBand = React.useCallback(
    (next: { lo: number; hi: number }) => {
      const lo = Math.min(next.lo, next.hi);
      const hi = Math.max(next.lo, next.hi);
      setBand({ lo, hi });
      setGroundBand(session, { lo, hi });
    },
    [session],
  );

  const pickFloor = React.useCallback(
    (floorName: string | null) => {
      const picked = floorOptions.find((floor) => floor.name === floorName);
      changeBand(picked ? picked.levels : fullBand(voxels));
    },
    [floorOptions, changeBand, voxels],
  );

  /**
   * One Save for what changed: the ground patches, the forbidden zones and
   * the waypoints, each written and reported apart, so one refused leaves
   * the others saved.
   */
  const onSave = React.useCallback(() => {
    if (runLock.locked || note.kind === "saving" || zoneNote.kind === "saving") return;
    // A removal is staged without asking, so Undo can take it back; Save is
    // where it opens an area to the robot, and is asked once. No means no
    // Save at all, so a cancel never leaves half the edits sent.
    const gone = zonesDirty ? removedZones(zoneEdit.saved ?? [], zones ?? []) : [];
    if (gone.length > 0 && !window.confirm(zoneDeleteQuestion(gone))) return;
    if (verticesDirty && !vertexWriting) {
      // The plan as of the press; rebaseVertices folds in what landed, so a
      // stop placed mid-request stays unsaved, and a refusal keeps the rest.
      setVertexNote({ kind: "saving" });
      void saveVertices(planVertexSave(savedVertices, vertexList)).then(({ landed, failure }) => {
        const { ids } = rebaseVertices([], [], landed);
        setSavedVertices((current) => rebaseVertices(current, [], landed).saved);
        setVertexList((current) => rebaseVertices([], current, landed).working);
        setMoving((current) => current && { ...current, id: ids.get(current.id) ?? current.id });
        setSelectedIds((current) => current.map((id) => ids.get(id) ?? id));
        setVertexNote(
          failure
            ? { kind: "failed", message: vertexSaveFailure(landed, failure) }
            : { kind: "saved", message: `Waypoints saved: ${vertexSaveSummary(landed)}` },
        );
      });
    }
    if (dirty) {
      const sent = new Map(session.edits);
      setNote({ kind: "saving" });
      save(
        { name, fillKey: toFillKeys(sent, voxels) },
        {
          onSuccess: (result) => {
            savedRef.current = sent;
            setDirty(!sameEdits(session.edits, sent));
            setNote({ kind: "saved", message: result.message });
          },
          onError: (cause) => setNote({ kind: "failed", message: cause.message }),
        },
      );
    }
    if (zonesDirty) saveZoneEdits();
  }, [
    runLock.locked,
    note.kind,
    zoneNote.kind,
    dirty,
    session,
    save,
    name,
    voxels,
    zonesDirty,
    zoneEdit.saved,
    zones,
    saveZoneEdits,
    verticesDirty,
    vertexWriting,
    saveVertices,
    savedVertices,
    vertexList,
  ]);


  useLeaveGuard(unsaved);

  const bandLoM = kzToMetres(band.lo, voxels);
  const bandHiM = kzToMetres(band.hi, voxels);
  const full = fullBand(voxels);
  // The band's levels as the metres the 3D layer filters cell centres by.
  const bandM = React.useMemo(
    () => ({ lo: bandLoM - res / 2, hi: bandHiM + res / 2 }),
    [bandLoM, bandHiM, res],
  );
  const pickedFloor =
    floorOptions.find((floor) => floor.levels.lo === band.lo && floor.levels.hi === band.hi)
      ?.name ?? (band.lo === full.lo && band.hi === full.hi ? null : undefined);
  const minM = kzToMetres(full.lo, voxels);
  const maxM = kzToMetres(full.hi, voxels);

  // The floor picked, as the dashboard holds it: its stops alone are shown,
  // and a stop placed on it stands at the ground under it. A hand-set band is
  // no floor, so a new stop goes to the ground floor as with All.
  const floorBand = React.useMemo(
    () => floorBands(floors).find((floor) => floor.name === pickedFloor) ?? null,
    [floors, pickedFloor],
  );
  const vertexBand = useFloorBand(floorBand);
  // The plane a press is cast onto: the floor's one height (memoised, since
  // the measure walks every cell), or a re-placed stop's own with none picked.
  const floorZ = React.useMemo(() => floorGroundOf(voxels, floorBand), [voxels, floorBand]);
  const placeZ = moving && !floorBand ? moving.z : floorZ;

  // The floor a new forbidden zone forbids: the one picked, on a map of
  // several storeys (a map of one has nothing to pick, and its zones cover
  // every floor). Its ground is where the 3D map
  // shows it, at the top face of the floor's cells -- the height the robot's
  // planner compares a zone's band with -- else a body height under its level.
  const zoneFloorBand = floorOptions.length > 1 ? floorBand : null;
  const zoneGroundZ = React.useMemo(() => {
    if (!zoneFloorBand) return null;
    const measured = floorHeightIn(voxels, zoneFloorBand.lo, zoneFloorBand.hi);
    return measured === null ? drawnGround(floorZ) : measured + voxels.res / 2;
  }, [voxels, zoneFloorBand, floorZ]);

  /**
   * Close the shape in flight into a zone, on screen: Save sends it,
   * banded to the floor picked on a map of several storeys.
   * An anchored shape does not close: it ends on its zone (mergeZone).
   */
  const closeZone = React.useCallback(() => {
    if (zoneLock !== null) return;
    closeZoneShape(zoneGroundZ === null ? undefined : zoneBandAround(zoneGroundZ));
  }, [zoneLock, zoneGroundZ, closeZoneShape]);

  /** End an anchored shape on another corner of its zone. */
  const mergeZone = React.useCallback(
    (target: number) => {
      if (zoneLock === null) mergeZoneOn(target);
    },
    [zoneLock, mergeZoneOn],
  );

  /** A dragged corner; a finished zone's only while the zones are writable. */
  const dragZoneCorner = React.useCallback(
    (corner: ZoneCornerRef, point: ZonePoint) => {
      if (corner.zoneId !== null && zoneLock !== null) return;
      moveZoneCorner(corner, point);
    },
    [zoneLock, moveZoneCorner],
  );

  /**
   * Take a zone off the map, staged for Save and not asked: Undo puts it
   * back, and Save asks before the robot loses it.
   */
  const removeZone = (zone: ZonePolygon) => {
    if (zoneLock === null) removeZones([zone.id]);
  };

  const placeLocked = placeLock !== null;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A shape in flight takes Escape, Enter and Backspace first: Escape
      // drops it rather than the whole Draw choice.
      if (zoneDraft.length > 0 && !isTypingTarget(event.target)) {
        if (event.key === "Escape") {
          event.preventDefault();
          dropZoneShape();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          closeZone();
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          popZoneCorner();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        chooseDraw(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
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
      if (mod) return;
      if (event.key === "0") {
        event.preventDefault();
        fit();
      } else if (event.key.toLowerCase() === "b") {
        setDrawKind("ground");
        changeTool("fill");
      } else if (event.key.toLowerCase() === "e") {
        setDrawKind("ground");
        changeTool("erase");
      } else if (event.key.toLowerCase() === "o") {
        changeTool("pan");
      } else if (event.key.toLowerCase() === "w" && !placeLocked) {
        setDrawKind("waypoint");
        changeTool("waypoint");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, fit, changeTool, chooseDraw, placeLocked, zoneDraft.length, closeZone, dropZoneShape, popZoneCorner]);

  /**
   * A release with Waypoint armed. A new stop asks for its name and leaves
   * the tool armed, since placing a run of stops is the common case; a
   * re-place is one stop's, so it disarms once the stop is put down.
   */
  const commitPlace = (picked: PlanarPose) => {
    const placed = {
      ...picked,
      z: placedGround({
        voxels,
        band: floorBand,
        hasFloors: floors.length > 0,
        x: picked.x,
        y: picked.y,
        moving: moving?.z,
      }),
    };
    if (moving) {
      const target = moving.id;
      setVertexList((current) =>
        current.map((vertex) => (vertex.id === target ? { ...vertex, ...placed } : vertex)),
      );
      setVertexNote({ kind: "idle" });
      changeTool("pan");
    } else {
      placing.begin(placed, placingCharger);
    }
  };

  /** Stage the named stop; Save sends it. */
  const createPlaced = (stopName: string, type: VertexType) => {
    if (!placement) return;
    localSerialRef.current += 1;
    const staged: MapVertex = {
      id: localVertexId(localSerialRef.current),
      map_name: name,
      name: stopName,
      type,
      ...placement.pose,
    };
    setVertexList((current) => [...current, staged]);
    setVertexNote({ kind: "idle" });
    placing.close();
  };

  /**
   * Take a stop off the screen. A stored one is deleted on Save; one placed
   * here simply never gets sent.
   */
  const dropVertex = (vertex: MapVertex) => {
    setVertexList((current) => current.filter((stop) => stop.id !== vertex.id));
    setVertexNote({ kind: "idle" });
  };

  // Place with the type set: armed, pressed again it is put down, and like
  // Place it stays armed for a run of stops.
  const armCharger = () => {
    if (tool === "waypoint" && placingCharger && !moving) {
      changeTool("pan");
      return;
    }
    changeTool("waypoint");
    setPlacingCharger(true);
  };

  const armReplace = (vertex: MapVertex) => {
    setAskedVertex(null);
    setMoving(vertex);
    setDrawKind("waypoint");
    setTool("waypoint");
    setPlacingCharger(false);
  };

  // Asked once, as the dialog's Delete asks: a finger's tap on the wrong
  // marker must not stage a stop's deletion unseen, and there is no undo for
  // waypoints here. Remove stays armed for the next one.
  const removeTapped = (vertex: MapVertex) => {
    if (!window.confirm(deleteQuestion(vertex.name))) return;
    dropVertex(vertex);
  };

  const deleteAsked = (vertex: MapVertex) => {
    dropVertex(vertex);
    setAskedVertex(null);
  };

  /**
   * A stop dragged with Move, put down where it was let go. Its height follows
   * placedGround as a re-place's does: the ground under it on the floor
   * picked, its own with none, so a 2F stop dragged with All up stays on 2F.
   */
  const moveVertex = (vertex: MapVertex, pose: PlanarPose) => {
    if (placeLock !== null) return;
    const z = placedGround({
      voxels,
      band: floorBand,
      hasFloors: floors.length > 0,
      x: pose.x,
      y: pose.y,
      moving: vertex.z,
    });
    setVertexList((current) =>
      current.map((stop) =>
        stop.id === vertex.id ? { ...stop, x: pose.x, y: pose.y, theta: pose.theta, z } : stop,
      ),
    );
    setVertexNote({ kind: "idle" });
  };

  /**
   * A pose typed into the stop's dialog. Its height follows the rule of where
   * the numbers came from: the robot's floor for Use robot position, as a new
   * stop put where the robot stands; else a re-place's, as Move's.
   */
  const setVertexPose = (vertex: MapVertex, { x, y, theta, robotZ }: TypedPose) => {
    if (placeLock !== null) return;
    const z =
      robotZ !== null
        ? robotGround(voxels, floorBands(floors), { x, y, z: robotZ })
        : placedGround({
            voxels,
            band: floorBand,
            hasFloors: floors.length > 0,
            x,
            y,
            moving: vertex.z,
          });
    setVertexList((current) =>
      current.map((stop) => (stop.id === vertex.id ? { ...stop, x, y, theta, z } : stop)),
    );
    setVertexNote({ kind: "idle" });
    setAskedVertex(null);
  };

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }, []);

  // Asked once, as Remove asks: there is no undo for waypoints here.
  const deleteSelected = React.useCallback(() => {
    if (placeLock !== null || selectedVertexIds.length === 0) return;
    const gone = new Set(selectedVertexIds);
    const question =
      selectedVertexIds.length === 1
        ? deleteQuestion(vertexList.find((vertex) => gone.has(vertex.id))?.name ?? "")
        : `Delete ${selectedVertexIds.length} waypoints? They are removed from the robot when you save.`;
    if (!window.confirm(question)) return;
    setVertexList((current) => current.filter((vertex) => !gone.has(vertex.id)));
    setSelectedIds([]);
    setVertexNote({ kind: "idle" });
  }, [placeLock, selectedVertexIds, vertexList]);

  // Delete or Backspace takes the selection; a zone
  // shape in flight has Backspace first.
  const hasSelection = selectedVertexIds.length > 0;
  React.useEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target) || zoneDraft.length > 0) return;
      event.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection, deleteSelected, zoneDraft.length]);

  return (
    // For the e2e suite only, as an attribute so it can't become an on-screen
    // diagnostic: data-patched (columns patched) proves a stroke filled or
    // erased, now that the Patched readout is off the screen by request.
    <div className="relative h-full w-full" data-patched={count}>
      <ViewportBoundary>
        <Map3dCanvas
          session={session}
          tool={tool}
          radius={radius}
          reach={reach}
          band={bandM}
          editsVersion={editsVersion}
          fitNonce={fitNonce}
          zoomStep={zoomStep}
          shading={shading}
          onStrokeCommit={commit}
          vertices={vertexList}
          vertexBand={vertexBand}
          movingVertex={moving}
          placeZ={placeZ}
          onPlaceCommit={commitPlace}
          onVertexActivate={setAskedVertex}
          onVertexRemove={removeTapped}
          selectedVertexIds={selectedVertexIds}
          onVertexSelect={(vertex) => toggleSelected(vertex.id)}
          onVertexMove={moveVertex}
          zones={zones ?? NO_ZONES}
          zoneFloor={zoneFloorBand ? vertexBand : null}
          zonePlaneZ={zoneGroundZ}
          zoneDraft={zoneDraft}
          zoneAnchor={zoneAnchor}
          onZoneCorner={addZoneCorner}
          onZoneClose={closeZone}
          onZoneAnchor={anchorZone}
          onZoneMerge={mergeZone}
          onZoneCornerDrag={dragZoneCorner}
          onZoneCornerDragEnd={endZoneCornerDrag}
          onZoneRemove={removeZone}
        />
      </ViewportBoundary>

      <VertexCreateDialog
        placement={placement}
        lockedReason={placeLock}
        robotPose={robotPose}
        robotPoseReason={robotPoseReason}
        // Nothing is written on Create, so there is nothing in flight or refused.
        busy={false}
        error={null}
        chargerDetect={{
          busy: placing.detecting,
          error: placing.detectError,
          // Staged like any other stop: nothing is sent until Save.
          onDetect: placing.detectCharger,
        }}
        onUseRobotPose={placing.takeRobotPose}
        onCreate={createPlaced}
        onClose={placing.close}
      />

      {/* No Move: this page opens maps the robot is not on, and is not where
        * the robot is sent from (see VertexMoveDialog). */}
      <VertexMoveDialog
        vertex={askedVertex}
        editLock={placeLock}
        deleting={false}
        deleteError={null}
        deleteQuestion={deleteQuestion}
        onReplace={armReplace}
        onDelete={deleteAsked}
        onSetPose={setVertexPose}
        robotPose={robotPose}
        robotPoseReason={robotPoseReason}
        onClose={() => setAskedVertex(null)}
      />

      {/* One row across the top, the tools left and Draw right, wrapping on a
        * phone. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Map3dToolBar
            className="pointer-events-auto"
            onFit={fit}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            dirty={dirty || zonesDirty || verticesDirty}
            saving={note.kind === "saving" || zoneNote.kind === "saving" || vertexWriting}
            writeLock={runLock.reason}
            onSave={onSave}
            drawKind={drawKind}
            tool={tool}
            onToolChange={changeTool}
            placeLock={placeLock}
            placingCharger={placingCharger}
            onArmCharger={armCharger}
            zoneLock={zoneLock}
            radius={radiusM}
            onRadiusChange={setRadiusM}
            shading={shading}
            onShadingChange={setShading}
          />
          {/* The floors hang under Draw, out of the row's flow so their
            * column does not push the panels on the left down; the sliders
            * there set any other band. */}
          <div className="relative ml-auto">
            <Map3dDrawBar
              className="pointer-events-auto"
              drawKind={drawKind}
              onDrawKindChange={chooseDraw}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
            />
            {floorOptions.length > 1 && (
              <FloorPicker
                className="pointer-events-auto absolute top-full right-0 mt-2"
                floors={floorOptions}
                value={pickedFloor}
                onChange={pickFloor}
              />
            )}
          </div>
        </div>

        {/* Narrower on a phone so the map's middle stays reachable beside it;
          * the long hint is desktop-only, since a finger has no room for prose. */}
        <div className="pointer-events-none flex min-h-0 w-44 flex-col gap-2 overflow-y-auto sm:w-60">
          {/* Shown while a re-place is live; it writes nothing, so it has
            * nothing in flight to show or refused. */}
          <VertexPlaceControl
            className="pointer-events-auto"
            vertex={moving}
            busy={false}
            error={null}
            onCancel={() => changeTool("pan")}
            onDismissError={() => {}}
          />
          {/* Folds, like Floors under it: on a phone this column is a third
            * of the map. Open by default, since the sliders are how a storey
            * is found on a map with no floors named. */}
          <details open className={cn(overlayPanel, "pointer-events-auto space-y-2 p-2.5")}>
            <summary className="instrument-label cursor-pointer text-muted-foreground">
              Heights shown
            </summary>
            <label className="block text-[11px] leading-snug">
              <span className="flex justify-between text-muted-foreground">
                <span>Lowest</span>
                <span className="readout">{bandLoM.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                aria-label="Lowest height shown"
                className="w-full accent-signal-cmd pointer-coarse:h-10"
                min={minM}
                max={maxM}
                step={res}
                value={bandLoM}
                onChange={(event) =>
                  changeBand({ lo: metresToKz(Number(event.target.value), voxels), hi: band.hi })
                }
              />
            </label>
            <label className="block text-[11px] leading-snug">
              <span className="flex justify-between text-muted-foreground">
                <span>Highest</span>
                <span className="readout">{bandHiM.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                aria-label="Highest height shown"
                className="w-full accent-signal-cmd pointer-coarse:h-10"
                min={minM}
                max={maxM}
                step={res}
                value={bandHiM}
                onChange={(event) =>
                  changeBand({ lo: band.lo, hi: metresToKz(Number(event.target.value), voxels) })
                }
              />
            </label>
          </details>

          {drawKind === "waypoint" && !verticesLocked && (
            <Map3dWaypointPanel
              className="pointer-events-auto"
              vertices={vertexList}
              selectedIds={selectedVertexIds}
              pendingIds={pendingVertexIds}
              lockReason={placeLock}
              onToggle={toggleSelected}
              onClear={() => setSelectedIds([])}
              onDelete={deleteSelected}
            />
          )}

          {drawKind === "zone" && (
            <div
              className={cn(
                overlayPanel,
                "pointer-events-auto space-y-1 px-2 py-1.5 text-[11px] leading-snug",
              )}
            >
              <p className="instrument-label text-muted-foreground">Forbidden zones</p>
              {/* Which floor a new zone forbids is the one fact the 3D view adds. */}
              <p>
                {zoneGroundZ === null
                  ? "A new zone forbids every floor."
                  : `A new zone forbids ${pickedFloor ?? "this floor"} only (ground ${zoneGroundZ.toFixed(1)} m).`}
              </p>
              {zoneDraft.length > 0 && (
                <p className="text-muted-foreground">
                  {zoneDraft.length} corner{zoneDraft.length === 1 ? "" : "s"}
                  {zoneAnchor
                    ? ` — joined to zone ${zoneAnchor.zoneId}: tap another of its corners to merge.`
                    : canCloseZone(zoneDraft)
                      ? " — tap the first to close, or press Enter."
                      : " — at least 3 to close."}
                </p>
              )}
              {zonesDirty && (
                <p className="text-signal-caution">Unsaved — press Save to send the zones to the robot.</p>
              )}
              {zoneDraft.length === 0 && tool === "zone" && (zones?.length ?? 0) > 0 && (
                <p className="text-muted-foreground">
                  Start on a zone&apos;s corner to grow or cut it; drag a corner to move it.
                </p>
              )}
              {zoneNote.kind === "saving" && <p className="text-muted-foreground">Saving…</p>}
              {zoneNote.kind === "saved" && <p className="text-signal-live">{zoneNote.message}</p>}
              {zoneNote.kind === "failed" && (
                <p role="alert" className="break-words text-signal-warn">
                  Not saved. {zoneNote.message}
                </p>
              )}
            </div>
          )}

          {(verticesDirty || vertexNote.kind !== "idle") && (
            <div
              className={cn(
                overlayPanel,
                "pointer-events-auto space-y-1 px-2 py-1.5 text-[11px] leading-snug",
              )}
            >
              <p className="instrument-label text-muted-foreground">Waypoints</p>
              {verticesDirty && vertexNote.kind !== "saving" && (
                <p className="text-signal-caution">
                  {unsavedVertexLine(planVertexSave(savedVertices, vertexList))}
                </p>
              )}
              {vertexNote.kind === "saving" && <p className="text-muted-foreground">Saving…</p>}
              {vertexNote.kind === "saved" && !verticesDirty && (
                <p role="status" className="text-signal-live">
                  {vertexNote.message}
                </p>
              )}
              {vertexNote.kind === "failed" && (
                <p role="alert" className="break-words text-signal-warn">
                  Not saved. {vertexNote.message}
                </p>
              )}
            </div>
          )}

          {skipped > 0 && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-caution",
              )}
            >
              {skipped} saved patch{skipped === 1 ? " lies" : "es lie"} outside this 3D map and
              {skipped === 1 ? " is" : " are"} not shown; saving will drop {skipped === 1 ? "it" : "them"}.
            </p>
          )}

          {runLock.reason && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-caution",
              )}
            >
              Read-only. {runLock.reason}
            </p>
          )}

          {note.kind === "saved" && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-live",
              )}
            >
              {note.message}
            </p>
          )}
          {note.kind === "failed" && (
            <p
              role="alert"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
              )}
            >
              Not saved. {note.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The question a stop's Delete asks: nothing leaves the robot until Save. */
/** What Save asks before the zones it would delete leave the robot. */
function zoneDeleteQuestion(gone: readonly ZonePolygon[]): string {
  const what =
    gone.length === 1
      ? `forbidden zone "${gone[0].name ?? gone[0].id}"`
      : `${gone.length} forbidden zones`;
  return `Delete ${what}? The robot may then drive there.`;
}

function deleteQuestion(stopName: string): string {
  return `Delete "${stopName}"? It is removed from the robot when you save.`;
}

/** "2 added · 1 moved — press Save to send them to the robot." */
function unsavedVertexLine(plan: ReturnType<typeof planVertexSave>): string {
  const parts = [
    plan.creates.length && `${plan.creates.length} added`,
    plan.updates.length && `${plan.updates.length} moved`,
    plan.deletes.length && `${plan.deletes.length} deleted`,
  ].filter(Boolean);
  return `Unsaved: ${parts.join(" · ")} — press Save to send them to the robot.`;
}
