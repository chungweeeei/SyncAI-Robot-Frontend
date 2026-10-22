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
import { Map3dToolBar } from "@/components/maps/map-3d-toolbar";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapVertexWrites } from "@/hooks/use-map-vertex-writes";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useMapEntry } from "@/hooks/use-maps";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { floorBands } from "@/lib/map/floors";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import {
  bandForHeights,
  columnFloors,
  fullBand,
  kzToMetres,
  medianFloor,
  metresToKz,
  type Band,
} from "@/lib/map/ground";
import { floorGroundOf, placedGround, robotGround } from "@/lib/map/waypoint-ground";
import { isTypingTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PlanarPose } from "@/lib/types/robot";

const subscribeNoop = () => () => {};

/**
 * The editor's 3D view: the 3D map in 3D, and the map's waypoints on it. It is
 * where a map with no floor plan gets its waypoints, which the floor plan
 * editor cannot place without a raster to place them on. They are written
 * as they are placed, the dashboard's flow, so there is nothing to save.
 *
 * Loads the tree (shared with the dashboard's layer) and mounts the surface
 * once it is in.
 */
export function Map3dEditor({
  name,
  openOnWaypoint = false,
}: {
  name: string;
  /** Arm the Waypoint tool on opening, for a link that came to place waypoints. */
  openOnWaypoint?: boolean;
}) {
  const entry = useMapEntry(name);
  const tree = useMapOctomap(name);
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
  if (!tree.voxels) {
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
      openOnWaypoint={openOnWaypoint}
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

/** The page's shell: tool state, the heights shown, shortcuts and the waypoint flow. */
function Map3dSurface({
  name,
  voxels,
  openOnWaypoint,
}: {
  name: string;
  voxels: OccupiedVoxels;
  openOnWaypoint: boolean;
}) {
  const [tool, setTool] = React.useState<Map3dTool>("orbit");
  /**
   * A link's ask to open on Waypoint, held until the run lock first reads
   * clear rather than armed at once: on a fresh load the job list may not
   * have answered yet, and the lock fails closed until it has, which would
   * disarm the tool as soon as it was set. Any tool picked drops the ask.
   */
  const [waypointAsked, setWaypointAsked] = React.useState(openOnWaypoint);
  const [band, setBand] = React.useState<Band>(() => fullBand(voxels));
  const [fitNonce, setFitNonce] = React.useState(0);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  // On by default: the outlines are what make walls and steps readable.
  const [shading, setShading] = React.useState(true);

  const runLock = useMapRunLock(name);
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

  // A lock arriving with Waypoint armed disarms it, during render rather than
  // in an effect, so the next release cannot write onto a read-only map. An
  // open name dialog stays up instead: its Create greys and the name survives.
  if (runLock.locked && tool === "waypoint") {
    setTool("orbit");
    setMoving(null);
  }

  /** Any tool change drops a re-place in hand. */
  const changeTool = React.useCallback((next: Map3dTool) => {
    setTool(next);
    setWaypointAsked(false);
    if (next !== "waypoint") setMoving(null);
  }, []);
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
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);

  const changeBand = React.useCallback((next: Band) => {
    setBand({ lo: Math.min(next.lo, next.hi), hi: Math.max(next.lo, next.hi) });
  }, []);

  const pickFloor = React.useCallback(
    (floorName: string | null) => {
      const picked = floorOptions.find((floor) => floor.name === floorName);
      changeBand(picked ? picked.levels : fullBand(voxels));
    },
    [floorOptions, changeBand, voxels],
  );

  const placeLocked = runLock.locked;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        changeTool("orbit");
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey) return;
      if (event.key === "0") {
        event.preventDefault();
        fit();
      } else if (event.key.toLowerCase() === "o") {
        changeTool("orbit");
      } else if (event.key.toLowerCase() === "w" && !placeLocked) {
        changeTool("waypoint");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fit, changeTool, placeLocked]);

  const bandLoM = kzToMetres(band.lo, voxels);
  const bandHiM = kzToMetres(band.hi, voxels);
  const full = fullBand(voxels);
  // The band's levels as the metres the 3D layer filters cell centres by.
  const bandM = React.useMemo(
    () => ({ lo: bandLoM - res / 2, hi: bandHiM + res / 2 }),
    [bandLoM, bandHiM, res],
  );
  // What Fit frames on: the floor the shown heights mostly stand on. Memoised,
  // since the measure walks every cell.
  const frameZ = React.useMemo(() => {
    const floor = medianFloor(columnFloors(voxels, band));
    return kzToMetres(floor ?? band.lo, voxels);
  }, [voxels, band]);
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
    setTool("waypoint");
  };

  // A refusal leaves the dialog up with the sentence in it.
  const deleteAsked = (vertex: MapVertex) => {
    void removeVertex(vertex.id).then((gone) => {
      if (gone) setAskedVertex(null);
    });
  };

  return (
    <div className="relative h-full w-full">
      <Map3dCanvas
        voxels={voxels}
        tool={tool}
        band={bandM}
        frameZ={frameZ}
        fitNonce={fitNonce}
        zoomStep={zoomStep}
        shading={shading}
        vertices={vertices}
        vertexBand={vertexBand}
        movingVertex={moving ?? savingVertex}
        placeZ={placeZ}
        onPlaceCommit={commitPlace}
        onVertexActivate={setAskedVertex}
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

      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Map3dToolBar
            className="pointer-events-auto"
            onFit={fit}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            tool={tool}
            onToolChange={changeTool}
            placeLock={runLock.reason}
            shading={shading}
            onShadingChange={setShading}
          />
        </div>

        {/* The floors, top-right as on the dashboard; the sliders on the left
          * set any other band. Out of the toolbar's row so its height does not
          * push the panel down, and under the toolbar on a phone, where the
          * toolbar takes the whole width. */}
        {floorOptions.length > 1 && (
          <FloorPicker
            className="pointer-events-auto absolute top-0 right-0 max-sm:top-14"
            floors={floorOptions}
            value={pickedFloor}
            onChange={pickFloor}
          />
        )}

        {/* Narrower on a phone so the map's middle stays reachable beside it. */}
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
        </div>
      </div>
    </div>
  );
}
