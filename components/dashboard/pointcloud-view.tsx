"use client";

import * as React from "react";

import { ArmedHint } from "@/components/console/armed-hint";
import { overlayPanel } from "@/components/console/instrument";
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
import { useGoalTask } from "@/hooks/use-goal-task";
import { useInitialPose } from "@/hooks/use-initial-pose";
import { useMapKeepout } from "@/hooks/use-map-keepout";
import { useMapPointCloud } from "@/hooks/use-map-point-cloud";
import { useActiveMap } from "@/hooks/use-maps";
import { useRobotMapPose } from "@/hooks/use-robot-map-pose";
import { useTelemetry } from "@/hooks/use-telemetry";
import { apiUrl } from "@/lib/api/config";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import { cn } from "@/lib/utils";
import type { MapVertex, VertexType } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Data-wiring wrapper for the 3D point-cloud viewer — the console's only
 * viewport since the 2D grid canvas was removed. Resolves the active map from
 * the catalogue for the ground plane and its stored vertices, subscribes the
 * telemetry WebSocket for pose and joint angles, and hosts the layer toggles.
 * The live body_cloud stream itself is owned by PointCloudCanvas, and its
 * health is deliberately not shown here any more: the stream is always on,
 * there was nothing an operator could do about the pill but read it, and a
 * scan that stops arriving is visible in the scene itself.
 *
 * It also owns the pick mode. A drag on the ground can mean several things —
 * a nav goal, an initial-pose estimate, a new stop or a moved one — and the
 * gesture is the same for all of them, so exactly one may be armed at a time.
 * Keeping that in one piece of state here (rather than a boolean inside each
 * flow's hook) is what makes arming one disarm the others by construction;
 * separate booleans would eventually be true together.
 *
 * Tapping a stored vertex is the third way a goal is set, and the only
 * one that needs no mode: the pose already exists and was named by whoever
 * placed it, so there is nothing to drag and nothing to disarm. It goes through
 * the same GoalTask as the other two — one running task, one read-back, one
 * Cancel button, however the pose was chosen.
 */
export function PointCloudView({
  robotId,
  className,
}: {
  robotId: string;
  className?: string;
}) {
  // Which map the stack loaded, and therefore which one's raster to lay under
  // the cloud. A failure or an unconverted map leaves activeMap.grid null and
  // the canvas renders the cloud with no ground plane, same as before.
  const { map: activeMap } = useActiveMap();
  const mapImageUrl = React.useMemo(
    () =>
      activeMap?.grid
        ? apiUrl(`/api/v1/maps/${encodeURIComponent(activeMap.name)}/image`)
        : undefined,
    [activeMap],
  );
  // The stops already placed on that map, drawn on the ground for context: where
  // the robot can be sent is part of reading where it is, and until now the only
  // place they existed was the gridmap editor. The one thing this screen may
  // write is a stop's position — see the hook on why that field and no other.
  //
  // The hook re-reads the map catalogue through its own useMaps, so the
  // dashboard mount costs a second GET /api/v1/maps. That is the price of
  // leaving the task screens' hook contract alone; both fetches are once per
  // mount, not polled.
  const stops = useActiveMapVertices();
  const { vertices, moveVertex, createVertex, removeVertex } = stops;
  // Robot pose + joints + planned route via the telemetry WebSocket — see
  // useTelemetry on the rates and on why this is a stream and not a poll.
  const { feed, path } = useTelemetry();
  const [showMapCloud, setShowMapCloud] = React.useState(false);
  // On by default, like the vertices and for the same reason: the route is a
  // single mark that says what the robot is doing right now, not a layer someone
  // turns on to inspect the localizer.
  const [showPath, setShowPath] = React.useState(true);
  // On by default, unlike the map cloud: the vertices are a handful of markers
  // that say what the map is *for*, while the cloud is hundreds of thousands of
  // points shown only when someone is checking the localizer.
  const [showVertices, setShowVertices] = React.useState(true);
  // The zones the planner keeps out of, drawn on the floor so a route that
  // swings wide, or a goal that is refused, has its reason on screen. On by
  // default for the vertices' reason: a few marks that say what the map is
  // for. A failed read draws none and offers no toggle, which is the same
  // face as a map with none — the editor is where a failure is said, since
  // it is where it would cost an edit.
  const [showZones, setShowZones] = React.useState(true);
  const { zones } = useMapKeepout(activeMap?.name ?? null);
  // Asked for only while the layer is on and the map has a scan to give, so
  // turning the layer on is what starts the download. The catalogue's own
  // flag gates it: a map with nothing on disk would only earn a refusal.
  const hasScan = activeMap?.has_pointcloud === true;
  const scan = useMapPointCloud(
    showMapCloud && hasScan && activeMap ? activeMap.name : null,
  );
  const [cameraMode, setCameraMode] = React.useState<"move" | "focus">("move");
  /**
   * Bumped to swing the camera overhead; the canvas owns the camera and reacts
   * to the change (see its `topDownNonce`). A counter rather than a boolean
   * because the useful thing about this control is pressing it *again* after
   * orbiting away, and a boolean would already be true.
   */
  const [topDownNonce, setTopDownNonce] = React.useState(0);
  /** Same shape as `topDownNonce`, for the Recenter button. */
  const [recenterNonce, setRecenterNonce] = React.useState(0);
  /**
   * The last Zoom in / Zoom out press, as a fresh object so the canvas can
   * tell a second press from the first (see its `zoomStep`). The factor is the
   * floor plan editor's, so a step is the same size on both maps.
   */
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  /**
   * What a drag on the ground currently produces — one value, not a mode plus a
   * separate "which vertex", because a re-place armed with no vertex (or a
   * vertex left behind by a disarmed re-place) is a state that must not exist.
   */
  const [pick, setPick] = React.useState<
    | { mode: "goal" | "initial-pose" | "place" }
    | { mode: "vertex"; vertex: MapVertex }
    | null
  >(null);
  /** The stop a tap is asking about; null when the dialog is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
  /**
   * The pose an Add waypoint drag produced, waiting for a name; null when the
   * dialog is closed. Held here and not written yet: the row is created when
   * the dialog's Create is pressed, so a placement that turns out wrong costs
   * a Cancel and nothing else. The key counts placements, so the dialog can
   * tell a new stop (fresh form) from the same stop moved onto the robot.
   */
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const placementSeq = React.useRef(0);
  // The robot's pose *on this map*, with the reason when there is none — the
  // same hook and the same sentences as the editor's Use robot position.
  const { pose: robotPose, reason: robotPoseReason } = useRobotMapPose(
    activeMap?.name ?? "",
  );
  /**
   * A stop whose new pose is being written. It keeps the marker off the map for
   * the length of the request: dropping it at release would put the old mark
   * back at the old spot until the PUT lands, which reads as the re-place having
   * been rejected and then, a moment later, applied.
   */
  const [savingVertex, setSavingVertex] = React.useState<MapVertex | null>(null);

  const task = useGoalTask(robotId);
  const estimate = useInitialPose();

  // Destructured because they are the stable parts of the hooks' return objects
  // (the objects themselves are fresh every render, so depending on those would
  // rebuild the callback on every telemetry frame).
  const { commitPose, clear: clearEstimate } = estimate;
  const { sendGoal } = task;

  const armPick = React.useCallback(
    (mode: "goal" | "initial-pose" | "place") => {
      // Arming the pose-estimate tool drops whatever the last drag left behind,
      // so the panel always describes the gesture in progress rather than the
      // previous one. It is also the deterministic half of the read-back's
      // clean-up: the timed auto-clear in useInitialPose handles the operator
      // who walks away, this handles the one who goes straight into another
      // drag, and between them Clear is never the only way out.
      if (mode === "initial-pose") clearEstimate();
      setPick((cur) => (cur?.mode === mode ? null : { mode }));
    },
    [clearEstimate],
  );

  // Arming a re-place replaces whatever was armed, for the same reason the two
  // pose tools are mutually exclusive: the gesture is identical, so only the
  // armed mode says what a drag means.
  const armReplace = React.useCallback((vertex: MapVertex) => {
    setAskedVertex(null);
    setPick({ mode: "vertex", vertex });
  }, []);

  // Single-shot, like RViz's nav-goal / pose-estimate tools: one drag, one pose,
  // then the mode disarms so a stray click on the map cannot fire another. Every
  // branch below commits on release — the estimate re-seeds the localizer, a
  // re-place writes the row, a goal dispatches a MOVE task, a placement opens
  // the dialog that will write it — so that disarm is the whole reason a
  // second click is inert. It used to cost a moved marker at worst; on the
  // goal branch it would cost a second robot movement.
  const commitPick = React.useCallback(
    (picked: PlanarPose) => {
      if (pick?.mode === "initial-pose") {
        commitPose(picked);
      } else if (pick?.mode === "place") {
        setPlacement({ key: ++placementSeq.current, pose: picked });
      } else if (pick?.mode === "vertex") {
        const target = pick.vertex;
        setSavingVertex(target);
        // The list is patched from the server's echo, so a success re-draws the
        // marker at its new pose in the same render that clears this.
        void moveVertex(target.id, picked).finally(() => setSavingVertex(null));
      } else {
        // Dispatched, not staged: the arrow the operator just aimed is the
        // confirmation, so there is no Send to press (see useGoalTask). The void
        // is safe — sendGoal reports its own failure through the task state that
        // GoalControl renders, which is also where the Retry for it lives.
        void sendGoal(picked);
      }
      setPick(null);
    },
    [pick, commitPose, sendGoal, moveVertex],
  );

  // Confirmed in the dialog, so it goes straight out as a MOVE task — the same
  // door a finished drag goes through, since the dialog asked the question the
  // drag answers by aiming. The dialog closes first: the task's own state is
  // reported by GoalControl, which is where an error from this submit shows up
  // too.
  const moveToVertex = React.useCallback(
    (vertex: MapVertex) => {
      setAskedVertex(null);
      void sendGoal({ x: vertex.x, y: vertex.y, theta: vertex.theta });
    },
    [sendGoal],
  );

  // Named in the dialog, so the row is written now. The dialog stays open on a
  // refusal with the backend's sentence in it, and closes only on the row
  // coming back: the marker it draws is the server's echo, spliced into the
  // same list the layer reads, so nothing here has to add one.
  const createPlaced = React.useCallback(
    (name: string, type: VertexType) => {
      if (!placement) return;
      void createVertex({ name, type, ...placement.pose }).then((created) => {
        if (created) setPlacement(null);
      });
    },
    [placement, createVertex],
  );

  // A snapshot, not a live binding, for the reason the editor's placeAtRobot
  // gives: a pose that crept across the map while its name was being typed
  // would be a stop nobody placed. Same key, so the typed name survives.
  const useRobotPose = React.useCallback(() => {
    if (!robotPose) return;
    setPlacement((cur) => (cur ? { ...cur, pose: robotPose } : cur));
  }, [robotPose]);

  const { clearWriteError } = stops;

  // Confirmed in the dialog. The list is patched from the delete's success,
  // so the marker leaves the map in the same render that closes this; a
  // refusal leaves the dialog up with the sentence in it.
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
    // A refusal belongs to the attempt it answered; the next placement starts
    // clean, and VertexPlaceControl must not show it over the map either.
    clearWriteError();
  }, [clearWriteError]);

  // Focus mode pins the target to the robot every frame, so a recenter that
  // left it on would be undone a frame later; the opening view is a Move view.
  const recenter = React.useCallback(() => {
    setCameraMode("move");
    setRecenterNonce((n) => n + 1);
  }, []);

  // Only the layers with something to hide. A toggle over an empty layer is
  // indistinguishable from a broken one — which is exactly how Map scan used to
  // read on a map with no scan — and Path comes and goes with the run, since
  // there is no route to hide between tasks.
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
      <PointCloudCanvas
        meta={activeMap?.grid ?? undefined}
        mapImageUrl={mapImageUrl}
        telemetry={feed}
        mapCloud={scan.cloud}
        path={path}
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
        deleting={stops.busy}
        deleteError={stops.writeError}
        onConfirm={moveToVertex}
        onReplace={armReplace}
        onDelete={deleteAsked}
        onClose={closeAsked}
      />

      {/* One row across the top: the map strip at the left, the viewport strip
        * at the right, wrapping onto two lines on a phone rather than
        * overlapping. The read-backs hang under it, on the left. The whole
        * overlay is pointer-transparent so the scene behind its empty stretches
        * still takes a drag — only the panels themselves catch the pointer. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <MapToolbar
            className="pointer-events-auto"
            placing={pick?.mode === "place"}
            canPlace={stops.mapName !== null}
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
            goalLocked={task.running || task.busy}
            onArmGoal={() => armPick("goal")}
            onArmInitialPose={() => armPick("initial-pose")}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            onTopDown={() => setTopDownNonce((n) => n + 1)}
            onZoomIn={() => setZoomStep({ factor: ZOOM_STEP_FACTOR })}
            onZoomOut={() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR })}
            layers={layers}
          />
        </div>

        {/* Goal first: it is the one used on every run, while an initial pose
          * is a recovery action. Scrolling because a phone held sideways leaves
          * the viewport ~200 px tall, and a goal read-back is taller than
          * that.
          *
          * The column itself is pointer-transparent and each panel opts back
          * in, so the armed hint — a sentence, nothing to press — never
          * swallows the press it is asking for. On a phone the two strips
          * stack and the hint lands mid-viewport, exactly where a thumb
          * goes; a hint that blocked the map there would be telling the
          * operator to do something it stopped them doing. */}
        <div className="pointer-events-none flex min-h-0 w-56 flex-col gap-2 overflow-y-auto empty:hidden">
          {/* What to do with the tool just armed. The icon said which tool it
            * is, but the next step happens on the map, where the pointer is
            * no longer over the tooltip — so the instruction is spelled out
            * here, in the tool's own hue, for as long as it is armed. */}
          {pick?.mode === "goal" && (
            <ArmedHint tone="cmd">Aim and release to send</ArmedHint>
          )}
          {pick?.mode === "initial-pose" && (
            <ArmedHint tone="caution">Press the map, then drag to aim</ArmedHint>
          )}
          {/* No hint for Add waypoint, by request: the lit button and the
            * marker carried under the pointer already say what is going on,
            * and the dialog that follows the release carries the rest. */}
          <GoalControl task={task} className="pointer-events-auto" />
          <InitialPoseControl estimate={estimate} className="pointer-events-auto" />
          {/* Only while it is live: a re-place is entered from the map, not
            * from here. It also outlives the gesture when the write fails —
            * that sentence has to land somewhere, and the panel that armed it
            * is where the operator is looking. */}
          <VertexPlaceControl
            className="pointer-events-auto"
            vertex={pick?.mode === "vertex" ? pick.vertex : null}
            // The hook reports one busy flag and one sentence for every
            // write; while a dialog is up they are its, and it shows them.
            busy={placement || askedVertex ? false : stops.busy}
            error={placement || askedVertex ? null : stops.writeError}
            onCancel={() => setPick(null)}
            onDismissError={stops.clearWriteError}
          />
          {/* A refused scan, in the backend's own words. It lasts as long as
            * the layer is on: turning the layer off dismisses it, and turning
            * it on again is the retry. */}
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
        </div>
      </div>

      {/* The drive panel used to live in this corner. It moved to the masthead
        * (DriveDisclosure) so it is the same control on every screen; nothing
        * takes its place here, because bottom-right being free is what lets the
        * operator park the panel there when the near-field returns are not in
        * the way. */}
    </div>
  );
}
