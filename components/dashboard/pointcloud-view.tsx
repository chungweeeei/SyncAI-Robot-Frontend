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
import { StopPanel } from "@/components/dashboard/stop-panel";
import { VertexCreateDialog } from "@/components/dashboard/vertex-create-dialog";
import { VertexPlaceControl } from "@/components/dashboard/vertex-place-control";
import {
  MapToolbar,
  ViewportToolbar,
  type LayerOption,
} from "@/components/dashboard/viewport-toolbar";
import { useActiveMapVertices } from "@/hooks/use-active-map-vertices";
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
import { useFloorBand } from "@/hooks/use-floor-band";
import { useWaypointPlacement } from "@/hooks/use-waypoint-placement";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { useRoutePreview } from "@/hooks/use-route-preview";
import { useTelemetry } from "@/hooks/use-telemetry";
import { useViewCommands } from "@/hooks/use-view-commands";
import {
  FLOOR_GROUND_BELOW_LEVEL_M,
  type FloorBand,
  floorBands,
  floorOfHeight,
  followHeight,
  followWindow,
  storeyCeiling,
} from "@/lib/map/floors";
import { isTypingTarget } from "@/lib/keyboard";
import { withGroundPatches } from "@/lib/map/ground-fill";
import { previewPoints, previewStale, routeFloors } from "@/lib/map/route-preview";
import { floorGroundOf, placedGround } from "@/lib/map/waypoint-ground";
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
  const { map: activeMap } = useActiveMap();
  // The one write this screen makes to a waypoint is its position (see the hook).
  const stops = useActiveMapVertices();
  const { vertices, moveVertex, createVertex, removeVertex } = stops;
  // Greys waypoint writes while a job drives on this map, keyed on the map the
  // waypoints belong to (see lib/map/run-lock.ts).
  const runLock = useMapRunLock(stops.mapName);
  const { engaged: stopped } = useConsoleEstop();
  const { feed, path } = useTelemetry();
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
  // The robot's 3D map, on by default: it is the map the robot navigates on,
  // and the viewport frames on it. The operator's own toggle wins, held per
  // map so another map's choice does not carry over. Offered only once the
  // robot reports it built — building, failed or never made has nothing to
  // give but a refusal, and the Maps screen is where those states are said.
  const [voxelChoice, setVoxelChoice] = React.useState<{ map: string; on: boolean } | null>(
    null,
  );
  const hasVoxels = activeMap?.octomap_status === "ok";
  const showVoxels =
    activeMap && voxelChoice?.map === activeMap.name ? voxelChoice.on : true;
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
  const { floors, ready: floorsReady } = useMapFloors(
    hasVoxels && activeMap ? activeMap.name : null,
  );
  const [floorName, setFloorName] = React.useState<string | null>(null);
  /**
   * A map of one storey is drawn under its ceiling (storeyCeiling), which
   * otherwise hides the robot and its waypoints in a room seen from above;
   * the picker's All, set here, puts the ceiling back. Only once the floors
   * have answered: a failed read may be a building's, and a building is
   * whole until a floor is picked.
   */
  const [ceilingShown, setCeilingShown] = React.useState(false);
  const oneStorey = floorsReady && floors.length <= 1;
  // The picker's one floor. A storey the backend found no floors in is
  // still a floor, at the map frame's 0 (storeyCeiling's reason).
  const storeyFloors = React.useMemo(
    () => (floors.length === 1 ? floors : [{ name: "1F", level: 0 }]),
    [floors],
  );
  const voxelCeiling = oneStorey && !ceilingShown ? storeyCeiling(floors) : Infinity;
  /**
   * Whether the floor on show is the robot's, which the picker's Follow
   * offers: an operator watching it climb a stair would otherwise switch
   * floors by hand at the landing. Any floor pressed ends it.
   */
  const [following, setFollowing] = React.useState(false);
  const bands = React.useMemo(() => floorBands(floors), [floors]);
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(
    activeMap?.name ?? "",
  );
  // The robot's floor by its body height, from the 1 Hz poll. Held through
  // the stair: between two floors' bands it is on neither, and a view that
  // fell back to All there would flick the whole building up mid-flight.
  // So would a lost fix, which says nothing about where it went.
  const robotFloor = robotPose ? floorOfHeight(robotPose.z, floors) : null;
  const [heldRobotFloor, setHeldRobotFloor] = React.useState<string | null>(null);
  if (robotFloor !== null && robotFloor !== heldRobotFloor) setHeldRobotFloor(robotFloor);
  const shownFloor = following ? (robotFloor ?? heldRobotFloor) : floorName;
  // What Follow draws is not that floor, though: a window cut around the
  // robot's body height, which slides up a stair with it where the floor
  // holds and then jumps. The floor stays what a pick, a waypoint, a zone and
  // the route are on, since those belong to a storey and not to a height.
  // Held by the step, and through a lost fix, for the floor's reasons.
  const [followZ, setFollowZ] = React.useState<number | null>(null);
  const nextFollowZ = robotPose ? followHeight(followZ, robotPose.z) : followZ;
  if (nextFollowZ !== followZ) setFollowZ(nextFollowZ);
  const followingZ = following && voxels ? followZ : null;
  const voxelWindow = React.useMemo(
    () => (followingZ === null ? null : followWindow(followingZ)),
    [followingZ],
  );
  const floorBand = voxels
    ? (bands.find((band) => band.name === shownFloor) ?? null)
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
  const voxelBand = useFloorBand(floorBand);
  const [cameraMode, setCameraMode] = React.useState<"move" | "focus">("move");
  // Counters, not booleans: the button must work again after orbiting away.
  const [recenterNonce, setRecenterNonce] = React.useState(0);
  const { zoomStep, zoomIn, zoomOut } = useViewCommands();
  /**
   * One value rather than a mode plus "which vertex", so a re-place with no
   * vertex cannot exist.
   */
  const [pick, setPick] = React.useState<
    | { mode: "goal" | "initial-pose" }
    // Add waypoint, or with `charger` Add charger: the same press, typed.
    | { mode: "place"; charger: boolean }
    | { mode: "vertex"; vertex: MapVertex }
    | null
  >(null);
  /** The stop a tap is asking about; null when its panel is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
  /** The asked stop was tapped while this console's goal ran: its route is owed. */
  const askedDuringGoal = React.useRef(false);
  /**
   * An Add waypoint pose waiting for a name; written only on Create, so a
   * wrong placement costs a Cancel (useWaypointPlacement, shared with the
   * map editor).
   */
  const {
    placement,
    begin: beginPlacement,
    close: closePlacement,
    takeRobotPose: useRobotPose,
    detectCharger: detectChargerPose,
    detecting: chargerDetectBusy,
    detectError: chargerDetectError,
    clearDetect: clearChargerDetect,
  } = useWaypointPlacement({ mapName: activeMap?.name ?? "", robotPose, voxels, bands });
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
    (stopped && pick?.mode === "goal")
  ) {
    setPick(null);
  }

  const task = useGoalTask(robotId, activeMap?.name ?? null);
  const routePreview = useRoutePreview(activeMap?.name ?? null);
  const estimate = useInitialPose();
  const localize = useAutoLocalize();

  // Destructured: the hooks' return objects are fresh every render, their
  // members are stable.
  const { commitPose, clear: clearEstimate } = estimate;
  const { sendGoal } = task;
  const { request: requestPreview, clear: clearPreview } = routePreview;

  // A preview belongs to the map it was aimed on: a switch, from here or
  // another console, leaves its route drawn over a building that is gone.
  const activeMapName = activeMap?.name ?? null;
  React.useEffect(() => clearPreview, [activeMapName, clearPreview]);
  // Out of date once the robot has walked off its start: said, not redrawn
  // (lib/map/route-preview.ts says why).
  const previewPointsWire = routePreview.preview?.reachable ? routePreview.preview.points : null;
  const stalePreview = previewStale(previewPointsWire ?? [], robotPose);
  const previewPath = React.useMemo(
    () => (previewPointsWire ? previewPoints(previewPointsWire) : null),
    [previewPointsWire],
  );
  const previewFloors = React.useMemo(
    () => (previewPointsWire ? routeFloors(previewPointsWire, floors) : []),
    [previewPointsWire, floors],
  );

  const armPick = React.useCallback(
    (mode: "goal" | "initial-pose") => {
      // Re-arming drops the last estimate, so the panel describes the drag in
      // progress. useInitialPose's timed clear covers an operator who walks away.
      if (mode === "initial-pose") clearEstimate();
      setPick((cur) => (cur?.mode === mode ? null : { mode }));
    },
    [clearEstimate],
  );
  // A press of the armed one puts it down; of the other, switches to it.
  const armPlace = React.useCallback((charger: boolean) => {
    setPick((cur) =>
      cur?.mode === "place" && cur.charger === charger ? null : { mode: "place", charger },
    );
  }, []);

  // Escape puts an armed tool down, as in the map editor, and hands the
  // primary button back to the camera. On the window, since focus stays on
  // the toolbar button that armed it; but not over a field, and not when a
  // dialog or a menu took the key first (it prevents the default), or one
  // press would close the menu and the tool together. A press planted and
  // held is dropped with it: its release no longer commits.
  const armed = pick !== null;
  React.useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setPick(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  const armReplace = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(null);
      clearPreview();
      setPick({ mode: "vertex", vertex });
    },
    [clearPreview],
  );

  // A pick lands on the floor shown, which is read off the 3D map: until the
  // tree is in there is no floor to pick, so every pick stays at 0, the
  // ground floor, as before floors. A re-place
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
          hasFloors: bands.length > 0,
          x: picked.x,
          y: picked.y,
          moving: pick?.mode === "vertex" ? pick.vertex.z : null,
        }),
      };
      if (pick?.mode === "initial-pose") {
        commitPose(floorBand ? placed : picked);
      } else if (pick?.mode === "place") {
        beginPlacement(placed, pick.charger);
      } else if (pick?.mode === "vertex") {
        const target = pick.vertex;
        setSavingVertex(target);
        // The echo patches the list in the same render that clears this.
        void moveVertex(target.id, placed).finally(() => setSavingVertex(null));
      } else {
        // Dispatched at once: the aimed arrow is the confirmation. Failures
        // surface in GoalControl through the task state. A preview on screen
        // is of some other goal now.
        clearPreview();
        void sendGoal(placed);
      }
      setPick(null);
    },
    [pick, voxels, floorBand, bands, commitPose, sendGoal, moveVertex, clearPreview, beginPlacement],
  );

  // A tapped stop asks for its route at once — a preview moves nothing — so
  // the route is on the map by the time the operator reads the panel, and
  // tap and Go is the whole of sending the robot there. Set goal stays
  // release-to-send; a stop is often across the building, where the way the
  // planner picks is the question. Not while this console's own goal runs:
  // its route is the one on the map then. The stop's own pose, z included,
  // so Go sends exactly what was previewed.
  const goalBusy = task.running || task.busy;
  const { clear: clearGoal } = task;
  // The waypoint the goal went to, by position: Go sends a stop's own x and
  // y, while the heading is normalised on the way out. A goal set on the map
  // matches none.
  const sentGoal = task.goal;
  const goalVertex = sentGoal
    ? (vertices.find((v) => v.x === sentGoal.x && v.y === sentGoal.y) ?? null)
    : null;
  const { clearWriteError } = stops;
  const previewVertex = React.useCallback(
    (vertex: MapVertex) =>
      requestPreview({ x: vertex.x, y: vertex.y, theta: vertex.theta, z: vertex.z }),
    [requestPreview],
  );
  const askVertex = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(vertex);
      // A refusal belongs to the stop it answered, not to the next one.
      clearWriteError();
      askedDuringGoal.current = goalBusy;
      if (goalBusy) {
        clearPreview();
      } else {
        // A failed or canceled goal's read-back is about the last decision;
        // a tap is the next one, and two cards stacked over the map read as
        // two jobs. Its Retry is this panel's Go now, and the outcome stays
        // in history. A running goal keeps its card: its Cancel is what the
        // panel's note points at.
        clearGoal();
        previewVertex(vertex);
      }
    },
    [goalBusy, previewVertex, clearPreview, clearWriteError, clearGoal],
  );

  // A stop tapped while the goal ran is asked about once the goal ends — on
  // arrival, when it was the next stop picked ahead, or by the panel's
  // Cancel — so the panel offers its Go
  // without a second tap. The ended goal's card goes with it, as on a tap:
  // the panel is the decision now, and closing it must not bring a Canceled
  // card back. A ref, not the preview's state: a mutation's variables land a
  // render late, so reading them here would ask a fresh tap's route twice.
  React.useEffect(() => {
    if (goalBusy || !askedVertex || !askedDuringGoal.current) return;
    askedDuringGoal.current = false;
    clearGoal();
    previewVertex(askedVertex);
  }, [goalBusy, askedVertex, clearGoal, previewVertex]);

  // Go hands over to GoalControl, which follows the job from here.
  const goVertex = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(null);
      clearPreview();
      void sendGoal({ x: vertex.x, y: vertex.y, theta: vertex.theta, z: vertex.z });
    },
    [clearPreview, sendGoal],
  );

  // Closes only once the row comes back; a refusal keeps the dialog up with
  // the backend's sentence. The marker is the server's echo in the list.
  const createPlaced = React.useCallback(
    (name: string, type: VertexType) => {
      if (!placement) return;
      // A failed look is answered by now; the line is the write's from here.
      clearChargerDetect();
      void createVertex({ name, type, ...placement.pose }).then((created) => {
        if (created) closePlacement();
      });
    },
    [placement, createVertex, clearChargerDetect, closePlacement],
  );

  // A refusal leaves the panel up with the sentence in it.
  const deleteAsked = React.useCallback(
    (vertex: MapVertex) => {
      void removeVertex(vertex.id).then((gone) => {
        if (!gone) return;
        setAskedVertex(null);
        clearPreview();
      });
    },
    [removeVertex, clearPreview],
  );
  const closeAsked = React.useCallback(() => {
    setAskedVertex(null);
    clearPreview();
    clearWriteError();
  }, [clearPreview, clearWriteError]);

  const closeCreate = React.useCallback(() => {
    closePlacement();
    // A refusal belongs to the attempt it answered, not to the next one.
    clearWriteError();
  }, [clearWriteError, closePlacement]);

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
  if (path !== undefined && path.points.length > 0) {
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
          telemetry={feed}
          mapCloud={scan.cloud}
          voxels={voxels}
          voxelBand={voxelBand}
          voxelWindow={voxelWindow}
          voxelCeiling={voxelCeiling}
          pickZ={pickZ}
          // The ground floor with every floor up: the view lifts to a floor
          // picked, and in Follow rides up with the robot's ground.
          viewGround={
            followingZ !== null
              ? followingZ - FLOOR_GROUND_BELOW_LEVEL_M
              : floorBand
                ? floorZ
                : 0
          }
          path={path}
          showPath={showPath}
          vertices={vertices}
          showVertices={showVertices}
          zones={zones ?? undefined}
          showZones={showZones}
          onVertexActivate={askVertex}
          movingVertex={
            pick?.mode === "vertex" ? pick.vertex : (savingVertex ?? null)
          }
          cameraMode={cameraMode}
          goal={task.goal}
          previewGoal={routePreview.goal}
          previewPath={previewPath}
          initialPose={estimate.pose}
          initialPoseGround={initialPoseGround}
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
        chargerDetect={{
          busy: chargerDetectBusy,
          error: chargerDetectError,
          onDetect: detectChargerPose,
        }}
        onUseRobotPose={useRobotPose}
        onCreate={createPlaced}
        onClose={closeCreate}
      />

      {/* Pointer-transparent so the scene behind its empty stretches still
        * takes a drag; only the panels catch the pointer. Pinned top and
        * bottom rather than capped: a definite height is what lets the
        * panels and the floor picker under the toolbars scroll inside it. */}
      <div className="pointer-events-none absolute inset-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <MapToolbar
            className="pointer-events-auto"
            placing={pick?.mode === "place" && !pick.charger}
            placingCharger={pick?.mode === "place" && pick.charger}
            canPlace={stops.mapName !== null}
            placeLock={runLock.reason}
            onRecenter={recenter}
            onArmPlace={() => armPlace(false)}
            onArmCharger={() => armPlace(true)}
          />

          <ViewportToolbar
            className="pointer-events-auto"
            pick={
              pick?.mode === "goal" || pick?.mode === "initial-pose"
                ? pick.mode
                : null
            }
            goalLocked={task.running || task.busy || stopped}
            goalLockReason={stopped ? ESTOP_REFUSAL : undefined}
            onArmGoal={() => armPick("goal")}
            onArmInitialPose={() => armPick("initial-pose")}
            autoLocalizeBusy={localize.busy}
            autoLocalizeLock={localize.lock}
            onAutoLocalize={localize.run}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            layers={layers}
          />
        </div>

        <div className="flex min-h-0 flex-1 items-start justify-between gap-2">
          {/* Goal first: it is used on every run, an initial pose is recovery.
            * Scrolls because a sideways phone leaves the viewport ~200 px tall.
            * Pointer-transparent with each panel opting back in, so the armed
            * hint never swallows the press it asks for. */}
          <div className="pointer-events-none flex max-h-full min-h-0 w-[min(14rem,calc(100%-5rem))] flex-col gap-2 overflow-y-auto empty:hidden">
            {/* The next step happens on the map, away from the tooltip, so it
              * is spelled out here while the tool is armed. */}
            {pick?.mode === "goal" && (
              <ArmedHint tone="cmd">Aim and release to send</ArmedHint>
            )}

            {pick?.mode === "initial-pose" && (
              <ArmedHint tone="caution">Press the map, then drag to aim</ArmedHint>
            )}
            {/* No hint for Add waypoint, by request: the carried marker says it. */}
            <StopPanel
              vertex={askedVertex}
              state={routePreview}
              floors={previewFloors}
              stale={stalePreview}
              running={goalBusy}
              goalHere={goalVertex !== null && goalVertex.id === askedVertex?.id}
              goalName={goalVertex?.name ?? null}
              cancelable={task.cancelable && !task.busy}
              onCancel={task.cancel}
              cancelError={goalBusy ? task.error : null}
              goLocked={goalBusy || stopped}
              goLockReason={stopped ? ESTOP_REFUSAL : null}
              editLock={runLock.reason}
              deleting={stops.busy}
              deleteError={stops.writeError}
              onGo={goVertex}
              onAgain={previewVertex}
              onReplace={armReplace}
              onDelete={deleteAsked}
              onClose={closeAsked}
              className="pointer-events-auto"
            />
            {/* One card at a time: an open stop carries the running goal's
              * Cancel itself, and the masthead still reads the job out. */}
            {!askedVertex && (
              <GoalControl
                task={task}
                name={goalVertex?.name ?? null}
                className="pointer-events-auto"
              />
            )}
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
              className="pointer-events-auto ml-auto max-h-full shrink-0"
              floors={bands}
              value={floorBand?.name ?? null}
              onChange={(name) => {
                setFollowing(false);
                setFloorName(name);
              }}
              following={following}
              onFollow={() => setFollowing(true)}
            />
          )}
          {/* One storey: All with its ceiling or the floor without, and no
            * Follow, since there is no other floor to follow the robot to. */}
          {voxels && oneStorey && (
            <FloorPicker
              className="pointer-events-auto ml-auto max-h-full shrink-0"
              floors={storeyFloors}
              value={ceilingShown ? null : storeyFloors[0].name}
              allTitle="Show the ceiling too"
              onChange={(name) => setCeilingShown(name === null)}
            />
          )}
        </div>
      </div>

      {/* Bottom-right stays empty so the floating drive panel can park there. */}
    </div>
  );
}
