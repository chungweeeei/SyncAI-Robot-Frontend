"use client";

import * as React from "react";

import { ArmedHint } from "@/components/console/armed-hint";
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
import { useMapKeepout } from "@/hooks/use-map-keepout";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapPointCloud } from "@/hooks/use-map-point-cloud";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useActiveMap } from "@/hooks/use-maps";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { useTelemetry } from "@/hooks/use-telemetry";
import { apiUrl } from "@/lib/api/config";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import { dispatchMapLock } from "@/lib/map/run-lock";
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
  // The robot's 3D map, off by default for the scan's reason: a million
  // cells, decoded and drawn when someone wants to look. Offered only once
  // the robot reports it built — building, failed or never made has nothing
  // to give but a refusal, and the Maps screen is where those states are
  // said. Not gated on the floor plan: a map with none still has its 3D map,
  // and the viewport frames on it instead.
  const [showVoxels, setShowVoxels] = React.useState(false);
  const hasVoxels = activeMap?.octomap_status === "ok";
  const octomap = useMapOctomap(
    showVoxels && hasVoxels && activeMap ? activeMap.name : null,
  );
  const [cameraMode, setCameraMode] = React.useState<"move" | "focus">("move");
  // Counters, not booleans: the button must work again after orbiting away.
  const [topDownNonce, setTopDownNonce] = React.useState(0);
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

  // Single-shot: one drag, one pose, then disarm. Every branch acts on release
  // (a goal moves the robot), so the disarm is what makes a stray second click
  // inert.
  const commitPick = React.useCallback(
    (picked: PlanarPose) => {
      if (pick?.mode === "initial-pose") {
        commitPose(picked);
      } else if (pick?.mode === "place") {
        setPlacement({ key: ++placementSeq.current, pose: picked });
      } else if (pick?.mode === "vertex") {
        const target = pick.vertex;
        setSavingVertex(target);
        // The echo patches the list in the same render that clears this.
        void moveVertex(target.id, picked).finally(() => setSavingVertex(null));
      } else {
        // Dispatched at once: the aimed arrow is the confirmation. Failures
        // surface in GoalControl through the task state.
        void sendGoal(picked);
      }
      setPick(null);
    },
    [pick, commitPose, sendGoal, moveVertex],
  );

  // The dialog closes first; GoalControl reports the job and any error.
  const moveToVertex = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(null);
      void sendGoal({ x: vertex.x, y: vertex.y, theta: vertex.theta });
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
  const useRobotPose = React.useCallback(() => {
    if (!robotPose) return;
    setPlacement((cur) => (cur ? { ...cur, pose: robotPose } : cur));
  }, [robotPose]);

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
      busy: octomap.status === "loading",
      onToggle: () => setShowVoxels((v) => !v),
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
      <PointCloudCanvas
        meta={activeMap?.grid ?? undefined}
        mapImageUrl={mapImageUrl}
        telemetry={feed}
        mapCloud={scan.cloud}
        voxels={octomap.voxels}
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
        topDownNonce={topDownNonce}
        recenterNonce={recenterNonce}
        zoomStep={zoomStep}
        pickMode={pick?.mode ?? null}
        onPickCommit={commitPick}
      />

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
            onZoomIn={() => setZoomStep({ factor: ZOOM_STEP_FACTOR })}
            onZoomOut={() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR })}
            layers={layers}
          />
        </div>

        {/* Goal first: it is used on every run, an initial pose is recovery.
          * Scrolls because a sideways phone leaves the viewport ~200 px tall.
          * Pointer-transparent with each panel opting back in, so the armed
          * hint never swallows the press it asks for. */}
        <div className="pointer-events-none flex min-h-0 w-56 flex-col gap-2 overflow-y-auto empty:hidden">
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
      </div>

      {/* Bottom-right stays empty so the floating drive panel can park there. */}
    </div>
  );
}
