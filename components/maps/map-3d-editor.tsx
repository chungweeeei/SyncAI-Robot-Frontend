"use client";

import * as React from "react";

import { FloorPicker } from "@/components/console/floor-picker";
import { overlayPanel } from "@/components/console/instrument";
import {
  VertexCreateDialog,
  type Placement,
} from "@/components/dashboard/vertex-create-dialog";
import { VertexMoveDialog } from "@/components/dashboard/vertex-move-dialog";
import { VertexPlaceControl } from "@/components/dashboard/vertex-place-control";
import { Map3dCanvas, type Map3dTool } from "@/components/maps/map-3d-canvas";
import {
  Map3dDrawBar,
  Map3dToolBar,
  type Map3dDrawKind,
} from "@/components/maps/map-3d-toolbar";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapVertexWrites } from "@/hooks/use-map-vertex-writes";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapOctomapEdits } from "@/hooks/use-map-octomap-edits";
import { useSaveMapOctomapEdits } from "@/hooks/use-map-actions";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useMapEntry } from "@/hooks/use-maps";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { floorBands } from "@/lib/map/floors";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import { bandForHeights, fullBand, kzToMetres, metresToKz } from "@/lib/map/ground";
import {
  DEFAULT_BRUSH_RADIUS_M,
  LOCAL_FLOOR_RING_M,
  applyGroundPatch,
  cellsFor,
  clearanceCells,
  createGroundSession,
  fromFillKeys,
  groundPatchBytes,
  sameEdits,
  setGroundBand,
  toFillKeys,
  type GroundEdits,
  type GroundPatch,
} from "@/lib/map/ground-fill";
import { createUndoStack, popRedo, popUndo, pushPatch } from "@/lib/map/patch";
import { floorGroundOf, placedGround, robotGround } from "@/lib/map/waypoint-ground";
import { isTypingTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PlanarPose } from "@/lib/types/robot";

const subscribeNoop = () => () => {};

/**
 * The editor's 3D view: the 3D map in 3D, and a brush that paints floor
 * into the holes the lidar never saw. A save records the patches on the
 * robot; the robot's own tool writes them into the tree, so the note after
 * a save says they wait to be applied.
 *
 * It is also where a map with no floor plan gets its waypoints, which the
 * floor plan editor cannot place without a raster to place them on. Those
 * are written as they are placed, the dashboard's flow, not on Save.
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
  // The status strip reads the catalogue too, so the entry can be cached
  // before this boundary hydrates; a guard drawn from it then would not be
  // the "Loading" the server drew without one.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  if (mounted && entry && entry.octomap_status !== "ok") {
    return (
      <Guard title="Cannot open the 3D map">
        {entry.octomap_status === "converting"
          ? "The robot is still building this map's 3D map. Come back once it has finished."
          : entry.octomap_status === "failed"
            ? (entry.octomap_error ?? "The robot could not build this map's 3D map.")
            : "This map has no 3D map. The robot builds one with the floor plan when it is set up to."}
      </Guard>
    );
  }
  if (tree.status === "error") {
    return <Guard title="Cannot open the 3D map">{tree.error}</Guard>;
  }
  if (edits.status === "error") {
    // Painting over an unread record would erase it on the first Save.
    return (
      <Guard title="Cannot open the 3D map">
        {edits.error ?? "The saved patches could not be read."}
      </Guard>
    );
  }
  if (!tree.voxels || edits.fillKey === null) {
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
      openOnWaypoint={openOnWaypoint}
      onDirtyChange={onDirtyChange}
    />
  );
}

function Guard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-md border border-hairline bg-panel p-4">
        <p className="instrument-label text-muted-foreground">{title}</p>
        <p className="mt-2 text-sm">{children}</p>
      </div>
    </div>
  );
}

type SaveNote =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string };

/**
 * The editor shell: tool state, the undo stack, shortcuts and the save flow.
 * The canvas owns the scene and the camera; they meet at the session
 * (lib/map/ground-fill.ts), which is mutable and never in React state.
 */
function Map3dSurface({
  name,
  voxels,
  initialFillKey,
  openOnWaypoint,
  onDirtyChange,
}: {
  name: string;
  voxels: OccupiedVoxels;
  initialFillKey: number[][];
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
   * What a press works on, chosen in the Draw list as on the floor plan
   * editor; the tools offered follow it. A link that came to place
   * waypoints opens on Waypoint.
   */
  const [drawKind, setDrawKind] = React.useState<Map3dDrawKind | null>(
    openOnWaypoint ? "waypoint" : null,
  );
  const [tool, setTool] = React.useState<Map3dTool>("orbit");
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
  const [fitNonce, setFitNonce] = React.useState(0);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  // On by default: the outlines are what make walls and steps readable.
  const [shading, setShading] = React.useState(true);
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [count, setCount] = React.useState(session.edits.size);
  const [dirty, setDirty] = React.useState(false);
  const [note, setNote] = React.useState<SaveNote>({ kind: "idle" });
  /** The patches as last saved, compared against the session's for `dirty`. */
  const savedRef = React.useRef<GroundEdits>(new Map(session.edits));
  const historyRef = React.useRef(createUndoStack<GroundPatch>(groundPatchBytes));

  const runLock = useMapRunLock(name);
  const { mutate: save } = useSaveMapOctomapEdits();
  const { floors } = useMapFloors(name);
  const stops = useMapVertexWrites(name);
  const { vertices, moveVertex, createVertex, removeVertex, clearWriteError } = stops;
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(name);
  /** The stop a re-place is carrying; Waypoint is armed while it is set. */
  const [moving, setMoving] = React.useState<MapVertex | null>(null);
  /** A placed pose waiting for a name; written only on Create. */
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const placementSeq = React.useRef(0);
  /** The stop a tap is asking about; null when the dialog is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
  /**
   * A stop whose new pose is being written. Keeps its marker hidden until the
   * PUT lands, or the old mark would flash back as if the move were refused.
   */
  const [savingVertex, setSavingVertex] = React.useState<MapVertex | null>(null);

  if (waypointAsked && !runLock.locked) {
    setWaypointAsked(false);
    setTool("waypoint");
  }

  // A lock arriving with Place or Remove armed disarms it, during render
  // rather than in an effect, so the next release cannot write onto a
  // read-only map. An open name dialog stays up instead: its Create greys and
  // the name survives.
  if (runLock.locked && (tool === "waypoint" || tool === "remove")) {
    setTool("orbit");
    setMoving(null);
  }

  /** Any tool change drops a re-place in hand. */
  const changeTool = React.useCallback((next: Map3dTool) => {
    setTool(next);
    setWaypointAsked(false);
    if (next !== "waypoint") setMoving(null);
  }, []);

  /** A new Draw choice starts on Orbit, as the floor plan's starts on Pan. */
  const chooseDraw = React.useCallback(
    (kind: Map3dDrawKind | null) => {
      setDrawKind(kind);
      changeTool("orbit");
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
  const ring = cellsFor(LOCAL_FLOOR_RING_M, res);
  const clearance = clearanceCells(res);

  const refresh = React.useCallback(() => {
    setEditsVersion((n) => n + 1);
    setCount(session.edits.size);
    setDirty(!sameEdits(session.edits, savedRef.current));
    setNote({ kind: "idle" });
  }, [session]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const commit = React.useCallback(
    (patch: GroundPatch) => {
      pushPatch(historyRef.current, patch);
      setCanUndo(true);
      setCanRedo(false);
      refresh();
    },
    [refresh],
  );

  const step = React.useCallback(
    (direction: "undo" | "redo") => {
      const stack = historyRef.current;
      const patch = direction === "undo" ? popUndo(stack) : popRedo(stack);
      if (!patch) return;
      setCanUndo(stack.undo.length > 0);
      setCanRedo(stack.redo.length > 0);
      applyGroundPatch(session.edits, patch, direction === "undo" ? "before" : "after");
      refresh();
    },
    [session, refresh],
  );
  const undo = React.useCallback(() => step("undo"), [step]);
  const redo = React.useCallback(() => step("redo"), [step]);
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);

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

  const onSave = React.useCallback(() => {
    if (runLock.locked || note.kind === "saving") return;
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
  }, [runLock.locked, note.kind, session, save, name, voxels]);

  const placeLocked = runLock.locked;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
        changeTool("orbit");
      } else if (event.key.toLowerCase() === "w" && !placeLocked) {
        setDrawKind("waypoint");
        changeTool("waypoint");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, fit, changeTool, chooseDraw, placeLocked]);

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

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
  const vertexLo = floorBand?.lo;
  const vertexHi = floorBand?.hi;
  const vertexBand = React.useMemo(
    () => (vertexLo === undefined || vertexHi === undefined ? null : { lo: vertexLo, hi: vertexHi }),
    [vertexLo, vertexHi],
  );
  // The plane a press is cast onto: the floor's one height (memoised, since
  // the measure walks every cell), or a re-placed stop's own with none picked.
  const floorZ = React.useMemo(() => floorGroundOf(voxels, floorBand), [voxels, floorBand]);
  const placeZ = moving && !floorBand ? moving.z : floorZ;

  // Single-shot, as on the dashboard: one press, one stop, then disarm.
  const commitPlace = (picked: PlanarPose) => {
    const placed = {
      ...picked,
      z: placedGround({ voxels, band: floorBand, x: picked.x, y: picked.y, moving: moving?.z }),
    };
    if (moving) {
      const target = moving;
      setSavingVertex(target);
      // The echo patches the list in the same render that clears this.
      void moveVertex(target.id, placed).finally(() => setSavingVertex(null));
    } else {
      setPlacement({ key: ++placementSeq.current, pose: placed });
    }
    changeTool("orbit");
  };

  // Closes only once the row comes back; a refusal keeps the dialog up with
  // the backend's sentence.
  const createPlaced = (stopName: string, type: VertexType) => {
    if (!placement) return;
    void createVertex({ name: stopName, type, ...placement.pose }).then((created) => {
      if (created) setPlacement(null);
    });
  };

  // A snapshot, not a live binding: a pose that crept while the name was typed
  // would be a stop nobody placed. Same key, so the typed name survives.
  const takeRobotPose = () => {
    if (!robotPose) return;
    const z = robotGround(voxels, floorBands(floors), robotPose);
    const pose = { x: robotPose.x, y: robotPose.y, theta: robotPose.theta, z };
    setPlacement((cur) => (cur ? { ...cur, pose } : cur));
  };

  const armReplace = (vertex: MapVertex) => {
    setAskedVertex(null);
    setMoving(vertex);
    setDrawKind("waypoint");
    setTool("waypoint");
  };

  // Asked once, as the dialog's Delete asks: a finger's tap on the wrong
  // marker must not take a stop off the robot. Remove stays armed for the
  // next one; a refusal lands in the place control's error.
  const removeTapped = (vertex: MapVertex) => {
    if (!window.confirm(`Delete "${vertex.name}"? This cannot be undone.`)) return;
    void removeVertex(vertex.id);
  };

  // A refusal leaves the dialog up with the sentence in it.
  const deleteAsked = (vertex: MapVertex) => {
    void removeVertex(vertex.id).then((gone) => {
      if (gone) setAskedVertex(null);
    });
  };

  return (
    // For the e2e suite only, as an attribute so it can't become an on-screen
    // diagnostic: data-patched (columns patched) proves a stroke filled or
    // erased, now that the Patched readout is off the screen by request.
    <div className="relative h-full w-full" data-patched={count}>
      <Map3dCanvas
        session={session}
        tool={tool}
        radius={radius}
        ring={ring}
        clearance={clearance}
        band={bandM}
        editsVersion={editsVersion}
        fitNonce={fitNonce}
        zoomStep={zoomStep}
        shading={shading}
        onStrokeCommit={commit}
        vertices={vertices}
        vertexBand={vertexBand}
        movingVertex={moving ?? savingVertex}
        placeZ={placeZ}
        onPlaceCommit={commitPlace}
        onVertexActivate={setAskedVertex}
        onVertexRemove={removeTapped}
      />

      <VertexCreateDialog
        placement={placement}
        lockedReason={runLock.reason}
        robotPose={robotPose}
        robotPoseReason={robotPoseReason}
        busy={stops.busy}
        error={stops.writeError}
        onUseRobotPose={takeRobotPose}
        onCreate={createPlaced}
        onClose={() => {
          setPlacement(null);
          // A refusal belongs to the attempt it answered, not to the next one.
          clearWriteError();
        }}
      />

      {/* No Move: this page opens maps the robot is not on, and is not where
        * the robot is sent from (see VertexMoveDialog). */}
      <VertexMoveDialog
        vertex={askedVertex}
        editLock={runLock.reason}
        deleting={stops.busy}
        deleteError={stops.writeError}
        onReplace={armReplace}
        onDelete={deleteAsked}
        onClose={() => {
          setAskedVertex(null);
          clearWriteError();
        }}
      />

      {/* One row across the top, the tools left and Draw right, wrapping on a
        * phone, as on the floor plan editor. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Map3dToolBar
            className="pointer-events-auto"
            onFit={fit}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            dirty={dirty}
            saving={note.kind === "saving"}
            writeLock={runLock.reason}
            onSave={onSave}
            drawKind={drawKind}
            tool={tool}
            onToolChange={changeTool}
            placeLock={runLock.reason}
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
          {/* Shown while a re-place is live, and after it when the write
            * fails, so the sentence lands where the operator is looking. */}
          <VertexPlaceControl
            className="pointer-events-auto"
            vertex={moving}
            // One busy flag and error for every write; an open dialog owns them.
            busy={placement || askedVertex ? false : stops.busy}
            error={placement || askedVertex ? null : stops.writeError}
            onCancel={() => changeTool("orbit")}
            onDismissError={clearWriteError}
          />
          <div className={cn(overlayPanel, "pointer-events-auto space-y-2 p-2.5")}>
            <p className="instrument-label text-muted-foreground">Heights shown</p>
            <label className="block text-[11px] leading-snug">
              <span className="flex justify-between text-muted-foreground">
                <span>Lowest</span>
                <span className="readout">{bandLoM.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                aria-label="Lowest height shown"
                className="w-full accent-signal-cmd"
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
                className="w-full accent-signal-cmd"
                min={minM}
                max={maxM}
                step={res}
                value={bandHiM}
                onChange={(event) =>
                  changeBand({ lo: band.lo, hi: metresToKz(Number(event.target.value), voxels) })
                }
              />
            </label>
          </div>

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
