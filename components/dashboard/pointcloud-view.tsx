"use client";

import * as React from "react";

import { ViewportBoundary } from "@/components/console/fault-boundary";
import { ArmedHint } from "@/components/console/armed-hint";
import { FloorPicker } from "@/components/console/floor-picker";
import { overlayPanel } from "@/components/console/instrument";
import { AutoLocalizeControl } from "@/components/dashboard/auto-localize-control";
import { GoalControl } from "@/components/dashboard/goal-control";
import { InitialPoseControl } from "@/components/dashboard/initial-pose-control";
import { PointCloudCanvas } from "@/components/dashboard/pointcloud-canvas";
import {
  VertexCreateDialog,
  type Placement,
} from "@/components/dashboard/vertex-create-dialog";
import { VertexMoveDialog } from "@/components/dashboard/vertex-move-dialog";
import { VertexPlaceControl } from "@/components/dashboard/vertex-place-control";
import {
  MapToolbar,
  ViewportToolbar,
  type LayerOption,
} from "@/components/dashboard/viewport-toolbar";
import { useActiveMapVertices } from "@/hooks/use-active-map-vertices";
import { useActiveRun } from "@/hooks/use-active-run";
import { useAutoLocalize } from "@/hooks/use-auto-localize";
import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { useGoalTask } from "@/hooks/use-goal-task";
import { useInitialPose } from "@/hooks/use-initial-pose";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapKeepout } from "@/hooks/use-map-keepout";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapOctomapEdits } from "@/hooks/use-map-octomap-edits";
import { useMapPointCloud } from "@/hooks/use-map-point-cloud";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useActiveMap } from "@/hooks/use-maps";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { useTelemetry } from "@/hooks/use-telemetry";
import { apiUrl } from "@/lib/api/config";
import { type FloorBand, floorBands } from "@/lib/map/floors";
import { withGroundPatches } from "@/lib/map/ground-fill";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import { dispatchMapLock } from "@/lib/map/run-lock";
import { floorGroundOf, placedGround, robotGround } from "@/lib/map/waypoint-ground";
import { liveDock } from "@/lib/task/run";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Data wiring for the 3D viewport: the active map, its waypoints and zones,
 * telemetry, and the layer toggles. The live scan's health is not shown; a
 * scan that stops arriving is visible in the scene.
 *
 * It owns the pick mode as one piece of state, because every pick is the same
 * gesture: arming one disarms the others by construction, where separate
 * booleans would eventually be true together. A tapped waypoint sends a goal
 * through the same GoalTask, so there is one running job however it was chosen.
 */
export function PointCloudView({
  robotId,
  className,
}: {
  robotId: string;
  className?: string;
}) {
  // A failure or an unconverted map leaves grid null: no ground plane.
  const { map: activeMap } = useActiveMap();
  const mapImageUrl = React.useMemo(
    () =>
      activeMap?.grid
        ? apiUrl(`/api/v1/maps/${encodeURIComponent(activeMap.name)}/image`)
        : undefined,
    [activeMap],
  );
  // The one write this screen makes to a waypoint is its position (see the hook).
  const stops = useActiveMapVertices();
  const { vertices, moveVertex, createVertex, removeVertex } = stops;
  // Greys waypoint writes while a job drives on this map, keyed on the map the
  // waypoints belong to (see lib/map/run-lock.ts).
  const runLock = useMapRunLock(stops.mapName);
  // The reverse: no goal onto a map whose floor plan is mid-rebuild.
  const { engaged: stopped } = useConsoleEstop();
  const dispatchLock = dispatchMapLock(activeMap);
  const { feed, path, dockPath } = useTelemetry();
  // A running dock's target, for its staging point. The same query entry the
  // status strip polls, so this adds no request. Only on the map the job runs
  // on: a dock pose drawn on another map's floor plan would be a place that
  // does not exist there.
  const { run } = useActiveRun();
  const dock =
    run && activeMap && run.task.map_name === activeMap.name
      ? liveDock(run.steps)
      : null;
  // Off by default: the map scan is for checking localization. Path, waypoints
  // and zones are on: a few marks that say what the robot and map are for.
  const [showMapCloud, setShowMapCloud] = React.useState(false);
  const [showPath, setShowPath] = React.useState(true);
  const [showVertices, setShowVertices] = React.useState(true);
  // A failed zone read draws none and offers no toggle; the editor is where
  // that failure is reported, since it is where it would cost an edit.
  const [showZones, setShowZones] = React.useState(true);
  const { zones } = useMapKeepout(activeMap?.name ?? null);
  // Turning the layer on starts the download, and only for a map that has a scan.
  const hasScan = activeMap?.has_pointcloud === true;
  const scan = useMapPointCloud(
    showMapCloud && hasScan && activeMap ? activeMap.name : null,
  );
  // The robot's 3D map. Its default follows what else the map has: off
  // under a floor plan, for the scan's reason — a million cells, decoded
  // and drawn when someone wants to look — and on without one, since a map
  // with no floor plan would otherwise open on an empty viewport while the
  // floor it has goes unshown (the viewport frames on the tree instead).
  // The operator's own toggle wins, held per map so another map's choice
  // does not carry over. Offered only once the robot reports it built —
  // building, failed or never made has nothing to give but a refusal, and
  // the Maps screen is where those states are said.
  const [voxelChoice, setVoxelChoice] = React.useState<{ map: string; on: boolean } | null>(
    null,
  );
  const hasVoxels = activeMap?.octomap_status === "ok";
  const showVoxels =
    activeMap && voxelChoice?.map === activeMap.name ? voxelChoice.on : !activeMap?.grid;
  const toggleVoxels = () => {
    if (activeMap) setVoxelChoice({ map: activeMap.name, on: !showVoxels });
  };
  const voxelMap = showVoxels && hasVoxels && activeMap ? activeMap.name : null;
  const octomap = useMapOctomap(voxelMap);
  // The ground patches saved for it, drawn in: the operator saved them for
  // the robot to drive on, and a save is only a record until the robot's
  // tool writes it into the tree — the dashboard showing the tree as built
  // read as if the save had been lost. Held back until the record has
  // answered, so a million-cell layer is built once and not twice. A record
  // that cannot be read costs the patches, never the map: this is a view.
  const patches = useMapOctomapEdits(voxelMap);
  const voxels = React.useMemo(
    () =>
      !octomap.voxels || patches.status === "loading"
        ? null
        : patches.fillKey
          ? withGroundPatches(octomap.voxels, patches.fillKey)
          : octomap.voxels,
    [octomap.voxels, patches.status, patches.fillKey],
  );
  // One floor of the 3D map at a time, for a map that spans storeys. A map
  // of one storey (or a failed read) has no floors and shows whole. Read
  // whenever the map has a 3D map, not only while it is drawn: "use the
  // robot's pose" has to know which floor the robot is on either way. Held
  // by name, so a floor renamed or gone elsewhere falls back to the whole
  // map instead of to a stale band. Picked only while the layer is up —
  // the floor is what that layer is showing.
  const { floors } = useMapFloors(hasVoxels && activeMap ? activeMap.name : null);
  const [floorName, setFloorName] = React.useState<string | null>(null);
  const bands = React.useMemo(() => floorBands(floors), [floors]);
  const floorBand = voxels
    ? (bands.find((band) => band.name === floorName) ?? null)
    : null;
  /** A floor's ground (lib/map/waypoint-ground.ts). */
  const groundOf = React.useCallback(
    (band: FloorBand | null) => floorGroundOf(voxels, band),
    [voxels],
  );
  // The floor shown's one height: the plane a pick is projected onto and its
  // marker drawn at, not what it is stored at (see commitPick). Memoised
  // because the measure walks every cell of the tree.
  const floorZ = React.useMemo(() => groundOf(floorBand), [groundOf, floorBand]);
  // Keyed on the two numbers: `floors` is a fresh list on every refetch, and
  // a fresh band object would repaint the layer for nothing.
  const bandLo = floorBand?.lo;
  const bandHi = floorBand?.hi;
  const voxelBand = React.useMemo(
    () => (bandLo === undefined || bandHi === undefined ? null : { lo: bandLo, hi: bandHi }),
    [bandLo, bandHi],
  );
  const [cameraMode, setCameraMode] = React.useState<"move" | "focus">("move");
  // Counters, not booleans: the button must work again after orbiting away.
  const [topDownNonce, setTopDownNonce] = React.useState(0);
  const [frontNonce, setFrontNonce] = React.useState(0);
  const [recenterNonce, setRecenterNonce] = React.useState(0);
  /** A fresh object per press; the factor is the floor plan editor's. */
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  /**
   * One value rather than a mode plus "which vertex", so a re-place with no
   * vertex cannot exist.
   */
  const [pick, setPick] = React.useState<
    | { mode: "goal" | "initial-pose" | "place" }
    | { mode: "vertex"; vertex: MapVertex }
    | null
  >(null);
  /** The stop a tap is asking about; null when the dialog is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
  /**
   * An Add waypoint pose waiting for a name; written only on Create, so a
   * wrong placement costs a Cancel. The key counts placements so the dialog
   * can tell a new stop from the same one moved onto the robot.
   */
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const placementSeq = React.useRef(0);
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(
    activeMap?.name ?? "",
  );
  /**
   * A stop whose new pose is being written. Keeps its marker hidden until the
   * PUT lands, or the old mark would flash back as if the move were refused.
   */
  const [savingVertex, setSavingVertex] = React.useState<MapVertex | null>(null);

  // A lock arriving with a pick armed disarms it, during render rather than in
  // an effect, so the next release cannot write onto a read-only map. An open
  // name dialog stays up instead: its Create greys and the typed name survives.
  if (
    (runLock.locked && (pick?.mode === "place" || pick?.mode === "vertex")) ||
    ((dispatchLock.locked || stopped) && pick?.mode === "goal")
  ) {
    setPick(null);
  }

  const task = useGoalTask(robotId, activeMap?.name ?? null);
  const estimate = useInitialPose();
  const localize = useAutoLocalize();

  // Destructured: the hooks' return objects are fresh every render, their
  // members are stable.
  const { commitPose, clear: clearEstimate } = estimate;
  const { sendGoal } = task;

  const armPick = React.useCallback(
    (mode: "goal" | "initial-pose" | "place") => {
      // Re-arming drops the last estimate, so the panel describes the drag in
      // progress. useInitialPose's timed clear covers an operator who walks away.
      if (mode === "initial-pose") clearEstimate();
      setPick((cur) => (cur?.mode === mode ? null : { mode }));
    },
    [clearEstimate],
  );

  const armReplace = React.useCallback((vertex: MapVertex) => {
    setAskedVertex(null);
    setPick({ mode: "vertex", vertex });
  }, []);

  // A pick lands on the floor shown, which only a 3D map has: a map is 3D
  // when it has an octomap.bt (the backend's and the robot's rule, a floor
  // plan beside it or not), and a 2D map has no floors to pick, so every
  // pick on it stays at 0, the ground floor, as before floors. A re-place
  // with no floor picked stays on its own floor: moving a 2F stop a metre
  // must not drop it to the ground floor because 2F was not up.
  const pickZ = pick?.mode === "vertex" && !floorBand ? pick.vertex.z : floorZ;
  // An initial pose says which floor only when one is picked; without one the
  // localizer keeps the storey it is on, the guess a seed upstairs (or back
  // down) has to overrule.
  const initialPoseGround = floorBand ? floorZ : null;

  // Single-shot: one drag, one pose, then disarm. Every branch acts on release
  // (a goal moves the robot), so the disarm is what makes a stray second click
  // inert.
  const commitPick = React.useCallback(
    (picked: PlanarPose) => {
      // The ground under it on the floor it was placed on goes with it, not
      // that floor's one height (placedGround says why).
      const placed = {
        ...picked,
        z: placedGround({
          voxels,
          band: floorBand,
          x: picked.x,
          y: picked.y,
          moving: pick?.mode === "vertex" ? pick.vertex.z : null,
        }),
      };
      if (pick?.mode === "initial-pose") {
        commitPose(floorBand ? placed : picked);
      } else if (pick?.mode === "place") {
        setPlacement({ key: ++placementSeq.current, pose: placed });
      } else if (pick?.mode === "vertex") {
        const target = pick.vertex;
        setSavingVertex(target);
        // The echo patches the list in the same render that clears this.
        void moveVertex(target.id, placed).finally(() => setSavingVertex(null));
      } else {
        // Dispatched at once: the aimed arrow is the confirmation. Failures
        // surface in GoalControl through the task state.
        void sendGoal(placed);
      }
      setPick(null);
    },
    [pick, voxels, floorBand, commitPose, sendGoal, moveVertex],
  );

  // The dialog closes first; GoalControl reports the job and any error.
  const moveToVertex = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(null);
      void sendGoal({ x: vertex.x, y: vertex.y, theta: vertex.theta, z: vertex.z });
    },
    [sendGoal],
  );

  // Closes only once the row comes back; a refusal keeps the dialog up with
  // the backend's sentence. The marker is the server's echo in the list.
  const createPlaced = React.useCallback(
    (name: string, type: VertexType) => {
      if (!placement) return;
      void createVertex({ name, type, ...placement.pose }).then((created) => {
        if (created) setPlacement(null);
      });
    },
    [placement, createVertex],
  );

  // A snapshot, not a live binding: a pose that crept while the name was typed
  // would be a stop nobody placed. Same key, so the typed name survives.
  // On the ground under the robot, on the floor its body height is in.
  const useRobotPose = React.useCallback(() => {
    if (!robotPose) return;
    const z = robotGround(voxels, bands, robotPose);
    const pose = { x: robotPose.x, y: robotPose.y, theta: robotPose.theta, z };
    setPlacement((cur) => (cur ? { ...cur, pose } : cur));
  }, [robotPose, bands, voxels]);

  const { clearWriteError } = stops;

  // A refusal leaves the dialog up with the sentence in it.
  const deleteAsked = React.useCallback(
    (vertex: MapVertex) => {
      void removeVertex(vertex.id).then((gone) => {
        if (gone) setAskedVertex(null);
      });
    },
    [removeVertex],
  );
  const closeAsked = React.useCallback(() => {
    setAskedVertex(null);
    clearWriteError();
  }, [clearWriteError]);

  const closeCreate = React.useCallback(() => {
    setPlacement(null);
    // A refusal belongs to the attempt it answered, not to the next one.
    clearWriteError();
  }, [clearWriteError]);

  // Focus would re-pin the target to the robot and undo the recenter.
  const recenter = React.useCallback(() => {
    setCameraMode("move");
    setRecenterNonce((n) => n + 1);
  }, []);

  // Only layers with something to hide: a toggle over an empty layer looks broken.
  const layers: LayerOption[] = [];
  if (hasScan) {
    layers.push({
      kind: "scan",
      label: "Map scan",
      on: showMapCloud,
      busy: scan.status === "loading",
      onToggle: () => setShowMapCloud((v) => !v),
    });
  }
  if (hasVoxels) {
    layers.push({
      kind: "voxels",
      label: "3D map",
      on: showVoxels,
      busy: octomap.status === "loading" || (octomap.voxels !== null && patches.status === "loading"),
      onToggle: toggleVoxels,
    });
  }
  if (vertices.length > 0) {
    layers.push({
      kind: "waypoints",
      label: "Waypoints",
      on: showVertices,
      onToggle: () => setShowVertices((v) => !v),
    });
  }
  if (zones && zones.length > 0) {
    layers.push({
      kind: "zones",
      label: "Forbidden zones",
      on: showZones,
      onToggle: () => setShowZones((v) => !v),
    });
  }
  const docking = dock !== null || (dockPath !== undefined && dockPath.points.length > 0);
  if ((path !== undefined && path.points.length > 0) || docking) {
    layers.push({
      kind: "path",
      label: "Path",
      on: showPath,
      onToggle: () => setShowPath((v) => !v),
    });
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      <ViewportBoundary>
        <PointCloudCanvas
          meta={activeMap?.grid ?? undefined}
          mapImageUrl={mapImageUrl}
          telemetry={feed}
          mapCloud={scan.cloud}
          voxels={voxels}
          voxelBand={voxelBand}
          pickZ={pickZ}
          path={path}
          dock={dock}
          dockPath={dockPath}
          showPath={showPath}
          vertices={vertices}
          showVertices={showVertices}
          zones={zones ?? undefined}
          showZones={showZones}
          onVertexActivate={setAskedVertex}
          movingVertex={
            pick?.mode === "vertex" ? pick.vertex : (savingVertex ?? null)
          }
          cameraMode={cameraMode}
          goal={task.goal}
          initialPose={estimate.pose}
          initialPoseGround={initialPoseGround}
          topDownNonce={topDownNonce}
          frontNonce={frontNonce}
          recenterNonce={recenterNonce}
          zoomStep={zoomStep}
          pickMode={pick?.mode ?? null}
          onPickCommit={commitPick}
        />
      </ViewportBoundary>

      <VertexCreateDialog
        placement={placement}
        lockedReason={runLock.reason}
        robotPose={robotPose}
        robotPoseReason={robotPoseReason}
        busy={stops.busy}
        error={stops.writeError}
        onUseRobotPose={useRobotPose}
        onCreate={createPlaced}
        onClose={closeCreate}
      />

      <VertexMoveDialog
        vertex={askedVertex}
        busy={task.busy}
        running={task.running}
        editLock={runLock.reason}
        dispatchLock={dispatchLock.reason}
        deleting={stops.busy}
        deleteError={stops.writeError}
        onConfirm={moveToVertex}
        onReplace={armReplace}
        onDelete={deleteAsked}
        onClose={closeAsked}
      />

      {/* Pointer-transparent so the scene behind its empty stretches still
        * takes a drag; only the panels catch the pointer. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <MapToolbar
            className="pointer-events-auto"
            placing={pick?.mode === "place"}
            canPlace={stops.mapName !== null}
            placeLock={runLock.reason}
            onRecenter={recenter}
            onArmPlace={() => armPick("place")}
          />

          <ViewportToolbar
            className="pointer-events-auto"
            pick={
              pick?.mode === "goal" || pick?.mode === "initial-pose"
                ? pick.mode
                : null
            }
            goalLocked={task.running || task.busy || dispatchLock.locked || stopped}
            goalLockReason={stopped ? ESTOP_REFUSAL : dispatchLock.reason}
            onArmGoal={() => armPick("goal")}
            onArmInitialPose={() => armPick("initial-pose")}
            autoLocalizeBusy={localize.busy}
            autoLocalizeLock={localize.lock}
            onAutoLocalize={localize.run}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            onTopDown={() => setTopDownNonce((n) => n + 1)}
            onFront={voxels ? () => setFrontNonce((n) => n + 1) : undefined}
            onZoomIn={() => setZoomStep({ factor: ZOOM_STEP_FACTOR })}
            onZoomOut={() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR })}
            layers={layers}
          />
        </div>

        <div className="flex min-h-0 items-start justify-between gap-2">
          {/* Goal first: it is used on every run, an initial pose is recovery.
            * Scrolls because a sideways phone leaves the viewport ~200 px tall.
            * Pointer-transparent with each panel opting back in, so the armed
            * hint never swallows the press it asks for. */}
          <div className="pointer-events-none flex max-h-full min-h-0 w-56 flex-col gap-2 overflow-y-auto empty:hidden">
            {/* The next step happens on the map, away from the tooltip, so it
              * is spelled out here while the tool is armed. */}
            {pick?.mode === "goal" && (
              <ArmedHint tone="cmd">Aim and release to send</ArmedHint>
            )}
            {pick?.mode === "initial-pose" && (
              <ArmedHint tone="caution">Press the map, then drag to aim</ArmedHint>
            )}
            {/* No hint for Add waypoint, by request: the carried marker says it. */}
            <GoalControl task={task} className="pointer-events-auto" />
            <InitialPoseControl estimate={estimate} className="pointer-events-auto" />
            <AutoLocalizeControl localize={localize} className="pointer-events-auto" />
            {/* Shown while a re-place is live, and after it when the write fails
              * so the sentence lands where the operator is looking. */}
            <VertexPlaceControl
              className="pointer-events-auto"
              vertex={pick?.mode === "vertex" ? pick.vertex : null}
              // One busy flag and error for every write; an open dialog owns them.
              busy={placement || askedVertex ? false : stops.busy}
              error={placement || askedVertex ? null : stops.writeError}
              onCancel={() => setPick(null)}
              onDismissError={stops.clearWriteError}
            />
            {/* Lasts while the layer is on; toggling it off and on is the retry. */}
            {scan.error && (
              <p
                role="alert"
                className={cn(
                  overlayPanel,
                  "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
                )}
              >
                {scan.error}
              </p>
            )}
            {/* The same for the 3D map: its toggle is the retry. */}
            {octomap.error && (
              <p
                role="alert"
                className={cn(
                  overlayPanel,
                  "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
                )}
              >
                {octomap.error}
              </p>
            )}
          </div>

          {/* The 3D map's floors, top-right under the view tools: part of what
            * is drawn, not a job, so apart from the panels on the left. */}
          {voxels && bands.length > 1 && (
            <FloorPicker
              className="pointer-events-auto ml-auto shrink-0"
              floors={bands}
              value={floorBand?.name ?? null}
              onChange={setFloorName}
            />
          )}
        </div>
      </div>

      {/* Bottom-right stays empty so the floating drive panel can park there. */}
    </div>
  );
}
