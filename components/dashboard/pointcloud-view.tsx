"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import { GoalControl } from "@/components/dashboard/goal-control";
import { InitialPoseControl } from "@/components/dashboard/initial-pose-control";
import { PointCloudCanvas } from "@/components/dashboard/pointcloud-canvas";
import { VertexMoveDialog } from "@/components/dashboard/vertex-move-dialog";
import { VertexPlaceControl } from "@/components/dashboard/vertex-place-control";
import {
  ViewportToolbar,
  type LayerOption,
} from "@/components/dashboard/viewport-toolbar";
import { useActiveMapVertices } from "@/hooks/use-active-map-vertices";
import { useGoalTask } from "@/hooks/use-goal-task";
import { useInitialPose } from "@/hooks/use-initial-pose";
import { useMapPointCloud } from "@/hooks/use-map-point-cloud";
import { useActiveMap } from "@/hooks/use-maps";
import { useTelemetry } from "@/hooks/use-telemetry";
import { apiUrl } from "@/lib/api/config";
import { cn } from "@/lib/utils";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";
import type { StreamStatus } from "@/lib/types/stream";

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "Connecting",
  open: "Scan live",
  closed: "Scan lost",
  error: "Scan error",
};

/**
 * Data-wiring wrapper for the 3D point-cloud viewer — the console's only
 * viewport since the 2D grid canvas was removed. Resolves the active map from
 * the catalogue for the ground plane and its stored vertices, subscribes the
 * telemetry WebSocket for pose and joint angles, and hosts the layer toggles.
 * The live body_cloud stream itself is owned by PointCloudCanvas.
 *
 * It also owns the pick mode. A drag on the ground can mean two things — a nav
 * goal or an initial-pose estimate — and the gesture is the same for both, so
 * exactly one may be armed at a time. Keeping that in one piece of state here
 * (rather than a boolean inside each flow's hook) is what makes arming one
 * disarm the other by construction; two booleans would eventually both be true.
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
  const { vertices, moveVertex } = stops;
  // Robot pose + joints + planned route via the telemetry WebSocket — see
  // useTelemetry on the rates and on why this is a stream and not a poll.
  const { feed, path } = useTelemetry();
  const [status, setStatus] = React.useState<StreamStatus>("connecting");
  const [showMapCloud, setShowMapCloud] = React.useState(false);
  // On by default, like the vertices and for the same reason: the route is a
  // single mark that says what the robot is doing right now, not a layer someone
  // turns on to inspect the localizer.
  const [showPath, setShowPath] = React.useState(true);
  // On by default, unlike the map cloud: the vertices are a handful of markers
  // that say what the map is *for*, while the cloud is hundreds of thousands of
  // points shown only when someone is checking the localizer.
  const [showVertices, setShowVertices] = React.useState(true);
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
  /**
   * What a drag on the ground currently produces — one value, not a mode plus a
   * separate "which vertex", because a re-place armed with no vertex (or a
   * vertex left behind by a disarmed re-place) is a state that must not exist.
   */
  const [pick, setPick] = React.useState<
    | { mode: "goal" | "initial-pose" }
    | { mode: "vertex"; vertex: MapVertex }
    | null
  >(null);
  /** The stop a tap is asking about; null when the dialog is closed. */
  const [askedVertex, setAskedVertex] = React.useState<MapVertex | null>(null);
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
    (mode: "goal" | "initial-pose") => {
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
  // re-place writes the row, a goal dispatches a MOVE task — so that disarm is
  // the whole reason a second click is inert. It used to cost a moved marker at
  // worst; on the goal branch it would cost a second robot movement.
  const commitPick = React.useCallback(
    (picked: PlanarPose) => {
      if (pick?.mode === "initial-pose") {
        commitPose(picked);
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
        onVertexActivate={setAskedVertex}
        movingVertex={
          pick?.mode === "vertex" ? pick.vertex : (savingVertex ?? null)
        }
        cameraMode={cameraMode}
        goal={task.goal}
        initialPose={estimate.pose}
        topDownNonce={topDownNonce}
        pickMode={pick?.mode ?? null}
        onPickCommit={commitPick}
        onStatus={setStatus}
      />

      <VertexMoveDialog
        vertex={askedVertex}
        busy={task.busy}
        running={task.running}
        onConfirm={moveToVertex}
        onReplace={armReplace}
        onClose={() => setAskedVertex(null)}
      />

      {/* One strip across the top: the toolbar at the left, stream health at
        * the right, wrapping onto two lines on a phone rather than overlapping.
        * The read-backs hang under it. The whole overlay is pointer-transparent
        * so the scene behind its empty stretches still takes a drag — only the
        * panels themselves catch the pointer. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ViewportToolbar
            className="pointer-events-auto"
            pick={pick?.mode === "vertex" ? null : (pick?.mode ?? null)}
            goalLocked={task.running || task.busy}
            onArmGoal={() => armPick("goal")}
            onArmInitialPose={() => armPick("initial-pose")}
            cameraMode={cameraMode}
            onCameraMode={setCameraMode}
            onTopDown={() => setTopDownNonce((n) => n + 1)}
            layers={layers}
          />

          {/* Stream health for the cloud itself. The status strip's sweep covers
            * the 1 Hz state poll; this WebSocket is a separate link that can fail
            * on its own, so it gets its own indicator — in the same three tones. */}
          <div
            className={cn(
              overlayPanel,
              "pointer-events-auto flex items-center gap-2 px-2 py-1.5",
            )}
          >
            <span
              className={cn(
                "inline-block size-2 rounded-full",
                status === "open"
                  ? "bg-signal-live"
                  : status === "connecting"
                    ? "bg-signal-caution"
                    : "bg-signal-warn",
              )}
            />
            <span className="instrument-label text-muted-foreground">
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>

        {/* Goal first: it is the one used on every run, while an initial pose
          * is a recovery action. Scrolling because a phone held sideways leaves
          * the viewport ~200 px tall, and a goal read-back is taller than
          * that. */}
        <div className="pointer-events-auto flex min-h-0 w-56 flex-col gap-2 overflow-y-auto empty:hidden">
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
          <GoalControl task={task} />
          <InitialPoseControl estimate={estimate} />
          {/* Only while it is live: a re-place is entered from the map, not
            * from here. It also outlives the gesture when the write fails —
            * that sentence has to land somewhere, and the panel that armed it
            * is where the operator is looking. */}
          <VertexPlaceControl
            vertex={pick?.mode === "vertex" ? pick.vertex : null}
            busy={stops.busy}
            error={stops.writeError}
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
                "px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
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

/**
 * The armed pose tool's next step, as a line of its own. `role="status"` so a
 * screen reader hears the instruction when the tool arms, which is when the
 * worded button it replaces used to change its name.
 */
function ArmedHint({
  tone,
  children,
}: {
  tone: "cmd" | "caution";
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      className={cn(
        overlayPanel,
        "instrument-label px-2 py-1.5",
        tone === "cmd"
          ? "border-signal-cmd/50 text-signal-cmd"
          : "border-signal-caution/50 text-signal-caution",
      )}
    >
      {children}
    </p>
  );
}
