"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import type { TelemetryFeed } from "@/hooks/use-telemetry";
import { cn } from "@/lib/utils";
import { G23_JOINTS } from "@/lib/robot/g23-joints";
import {
  DEFAULT_SPAN_M,
  TOP_DOWN_TILT,
  applyCameraMode,
  overheadDistance,
} from "@/lib/scene/camera";
import {
  LIVE_POINT_SIZE,
  MAP_POINT_SIZE,
  MAX_LIVE_POINTS,
  heightColor,
} from "@/lib/scene/live-cloud";
import {
  createPoseMarker,
  placePoseMarker,
  setMarkerColor,
} from "@/lib/scene/markers";
import { createPathRibbon } from "@/lib/scene/path-ribbon";
import { aimRaycaster, intersectGround } from "@/lib/scene/picking";
import { POSE_EASE_TAU_S, type SmoothPose } from "@/lib/scene/pose";
import {
  ROBOT_BASE_HEIGHT_M,
  loadRobotModel,
  warnedUnknownJoints,
} from "@/lib/scene/robot-model";
import { THEMES } from "@/lib/scene/theme";
import {
  createVertexLayer,
  type VertexLayer,
} from "@/lib/scene/vertex-layer";
import type { MapVertex } from "@/lib/types/map";
import type {
  MapMetadata,
  PlanarPose,
  PlannedPath,
  RobotPose,
} from "@/lib/types/robot";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";
import {
  createPointCloudStream,
  fetchMapPointCloud,
} from "@/lib/ros/pointcloud-stream";










/** Drag distance (CSS px) below which the heading is not taken from the drag. */
const HEADING_DEADZONE_PX = 8;

// Height (metres) the robot model floats at while it is being carried on the
// pointer, before a press plants it on the floor. Purely an affordance: held and
// placed have to look different, or a carried robot reads as a pose that is
// already set. Small enough that the shadowless model still lines up with the
// marker ring below it, which stays on the floor throughout.
const CARRY_LIFT_M = 0.35;






/**
 * The kinds of pose a drag on the viewport can produce.
 *
 * "vertex" re-places a stop that already exists, which is why the canvas needs
 * `movingVertex` alongside the mode: unlike the other two, the drag is *about*
 * a row, and the marker for it has to come off the map while it is in hand.
 */
export type PickMode = "goal" | "initial-pose" | "vertex";

interface PointCloudCanvasProps {
  /** 2D map metadata; when omitted the cloud renders with no ground plane. */
  meta?: MapMetadata;
  /**
   * Ground-plane texture URL — GET /api/v1/maps/{name}/image, absolute, from
   * apiUrl(). A plain URL rather than the base64 data URI the removed
   * /api/v1/map/image returned: TextureLoader takes either, and a real URL is
   * the one the browser can cache and revalidate against the endpoint's ETag.
   */
  mapImageUrl?: string;
  /**
   * Name of the map to load the static cloud for; required for showMapCloud to
   * do anything, since that cloud is now read per map from its saved map.pcd.
   */
  mapName?: string;
  /**
   * Where the robot is and how its legs are arranged, drained once per drawn
   * frame rather than arriving as props.
   *
   * A feed and not two values because the telemetry socket lands ~40 messages a
   * second: a prop is a render, so feeding it that way re-rendered this whole
   * subtree at the wire's rate for a change only the frame loop cares about.
   * The same arrangement the point cloud has always had, one layer up.
   *
   * Omitted leaves the robot hidden, which is what a cloud-only view wants.
   */
  telemetry?: TelemetryFeed;
  /** When true, also fetch and render the static localizer map cloud. */
  showMapCloud?: boolean;
  /**
   * The planner's remaining route, from the telemetry stream. Drawn as a band on
   * the floor between the robot and its goal, so an operator can read *how* the
   * robot means to get there — the one thing the viewport could not show before,
   * and the difference between catching a route that hugs a wall and finding out
   * when the robot is already against it.
   *
   * An empty `points` means the route is over; the layer simply is not built.
   */
  path?: PlannedPath;
  /** Hide the path layer without unmounting the canvas. Defaults to true. */
  showPath?: boolean;
  /**
   * The active map's stored vertices, drawn flat on the ground with their
   * headings and names. Read-only here: placing and editing them belongs to the
   * gridmap editor, and the dashboard's two ground gestures are already spoken
   * for by the pick modes below.
   */
  vertices?: MapVertex[];
  /** Hide the vertex layer without unmounting the canvas. Defaults to true. */
  showVertices?: boolean;
  /**
   * Fired when a stored vertex is double-clicked. Double, not single: a single
   * click on the viewport is already how the camera is driven, and a stop is a
   * place the robot will drive to — the gesture that proposes that has to be one
   * the operator cannot make by brushing the map.
   *
   * What it means is "the operator asked about this stop", not "go there": the
   * canvas never dispatches a task, it hands the row up and the view asks.
   */
  onVertexActivate?: (vertex: MapVertex) => void;
  /**
   * The vertex a `"vertex"` pick is re-placing. Its stored marker is hidden for
   * the duration — the draft under the pointer is the same stop, and drawing it
   * twice would leave the operator unsure which one they are about to save — and
   * its heading seeds the draft, so releasing without a drag keeps the heading it
   * already had instead of snapping to 0°.
   */
  movingVertex?: MapVertex | null;
  /**
   * Camera interaction mode. "move" = free navigation, left-drag pans the
   * scene. "focus" = the camera locks onto the robot (target follows its pose
   * and stays centred), left-drag orbits around it. Defaults to "move".
   */
  cameraMode?: "move" | "focus";
  /**
   * Bumped by the view's top-down button to swing the camera overhead. A nonce
   * rather than a callback the view holds, the same shape the gridmap editor's
   * Fit action uses (`fitNonce` in components/maps/grid-canvas.tsx): the camera
   * lives in here, and handing out a setter would give the view a second way to
   * reach it. 0 means "never pressed", so a fresh mount keeps its default view.
   *
   * It is an action, not a mode — nothing stops the next drag from orbiting
   * straight back out of it, which is why it is a button rather than a third
   * option beside Move / Focus.
   */
  topDownNonce?: number;
  /**
   * Open the streamed "map so far" WebSocket — pgo's merged, loop-closure-
   * corrected keyframe cloud, which only has a producer while a mapping
   * session is up — and render it as a dim layer under the live scan. Each
   * frame REPLACES the layer wholesale (a loop closure moves the whole map, so
   * accumulation client-side would be wrong). Defaults to false; the mapping
   * page is the one surface that turns it on.
   */
  mapCloudStream?: boolean;
  /**
   * Status of the map-cloud stream, separate from `onStatus` (the live
   * scan's): the two sockets fail independently and the mapping page shows
   * each with its own pill.
   */
  onMapStatus?: (status: StreamStatus) => void;
  /** Committed goal, drawn on the ground until the caller clears it. */
  goal?: PlanarPose | null;
  /**
   * The initial pose the operator last placed, drawn in the caution hue until
   * cleared. It outlives the publication on purpose — it is the reference the
   * reported pose is read against while the localizer's ICP converges — but only
   * by seconds: useInitialPose expires a published estimate on its own, and this
   * marker goes with it.
   */
  initialPose?: PlanarPose | null;
  /**
   * What a press-drag-release on the ground currently produces, or null for
   * none (RViz style either way): the press point is projected onto the z=0 map
   * plane and the drag direction gives the heading. Left-button camera motion is
   * suspended while a mode is armed.
   *
   * In "initial-pose" mode the robot model is picked up as soon as the mode is
   * armed: it floats under the bare pointer until a press plants it, so the
   * preview is the machine itself rather than only the draft arrow.
   *
   * One mode at a time — the gesture is identical for both, so the only thing
   * telling the operator (and this canvas) which pose they are placing is which
   * mode is armed. The view owns that choice.
   */
  pickMode?: PickMode | null;
  /** Fired once on release with the dragged pose, for whichever mode is armed. */
  onPickCommit?: (pose: PlanarPose) => void;
  onStatus?: (status: StreamStatus) => void;
  className?: string;
}

export function PointCloudCanvas({
  meta,
  mapImageUrl,
  mapName,
  telemetry,
  showMapCloud,
  path,
  showPath = true,
  vertices,
  showVertices = true,
  onVertexActivate,
  movingVertex = null,
  cameraMode = "move",
  topDownNonce = 0,
  mapCloudStream = false,
  onMapStatus,
  goal = null,
  initialPose = null,
  pickMode = null,
  onPickCommit,
  onStatus,
  className,
}: PointCloudCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  // Pose being carried / dragged right now. Kept in state (not a ref) so the
  // marker effect below runs on every pointer move; the scene itself is
  // untouched, so this costs a marker transform per frame, not a rebuild.
  const [draft, setDraft] = React.useState<PlanarPose | null>(null);

  /**
   * True while the draft is being *carried* — following the bare pointer with no
   * button down — as opposed to planted by a press and being turned by a drag.
   *
   * Only initial-pose mode carries. Arming it takes the robot out of the pose
   * feed's hands and puts it in the pointer's, so the operator sees the machine
   * itself track the cursor and can read the fit against the cloud before
   * committing to a spot; a press then pins that spot and the drag aims it.
   */
  const [carrying, setCarrying] = React.useState(false);

  // All mutable three.js objects live here so the pose / map-cloud effects can
  // reach into the scene without tearing it down.
  const sceneRef = React.useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    liveGeom: THREE.BufferGeometry;
    mapPoints: THREE.Points | null;
    /**
     * The streamed "map so far" layer (mapCloudStream), rebuilt wholesale per
     * frame — frames arrive seconds apart, unlike the preallocated 10 Hz
     * liveGeom above.
     */
    streamedMapPoints: THREE.Points | null;
    /**
     * The map extent this scene was built around, in metres, or null when there
     * is no 2D map. Kept here rather than read off the `meta` prop so the
     * top-down effect can frame the map without listing `meta` as a dependency —
     * which would re-frame the camera every time a map loads.
     */
    mapFrame: { cx: number; cy: number; widthM: number; heightM: number } | null;
    goalMarker: THREE.Group;
    initialPoseMarker: THREE.Group;
    draftMarker: THREE.Group;
    dispose: () => void;
  } | null>(null);

  // Keep the latest onStatus without forcing the setup effect to re-run.
  const onStatusRef = React.useRef(onStatus);
  React.useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  // Same treatment for the map-cloud stream's status callback.
  const onMapStatusRef = React.useRef(onMapStatus);
  React.useEffect(() => {
    onMapStatusRef.current = onMapStatus;
  }, [onMapStatus]);

  /**
   * Last frame of the streamed map cloud, held so the layer survives a scene
   * rebuild. The live cloud needs no such thing — its next frame is 100 ms
   * away — but this one arrives every few seconds, and a theme toggle or map
   * load in between would otherwise leave the layer empty until then.
   */
  const mapStreamFrameRef = React.useRef<PointCloudFrame | null>(null);

  const applyMapStreamFrame = React.useCallback(
    (frame: PointCloudFrame) => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      if (ctx.streamedMapPoints) {
        ctx.scene.remove(ctx.streamedMapPoints);
        ctx.streamedMapPoints.geometry.dispose();
        (ctx.streamedMapPoints.material as THREE.Material).dispose();
        ctx.streamedMapPoints = null;
      }
      const geom = new THREE.BufferGeometry();
      // Zero-copy is safe: each WS message owns its ArrayBuffer, and the layer
      // is replaced (never appended to) when the next frame arrives.
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(frame.positions, 3),
      );
      const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
      // The static map cloud's dim solid treatment, for the same reason it has
      // one: the height-coloured live scan must read on top of the map.
      const points = new THREE.Points(
        geom,
        new THREE.PointsMaterial({
          size: MAP_POINT_SIZE,
          color: theme.mapCloud,
          opacity: 0.6,
          transparent: true,
        }),
      );
      points.frustumCulled = false;
      ctx.streamedMapPoints = points;
      ctx.scene.add(points);
    },
    [resolvedTheme],
  );

  // Read by the stream effect through a ref so a theme change (which remakes
  // the callback above) re-tints via the setup effect's re-apply instead of
  // bouncing the WebSocket through its 2 s reconnect loop.
  const applyMapStreamFrameRef = React.useRef(applyMapStreamFrame);
  React.useEffect(() => {
    applyMapStreamFrameRef.current = applyMapStreamFrame;
  }, [applyMapStreamFrame]);

  // Camera mode + pose easing state, read by the render loop and by effects
  // that must not re-run on every change without listing them as deps.
  //
  // Both pose refs live at component scope rather than inside the scene-setup
  // effect so a map load or theme toggle rebuilds the renderer without
  // restarting the animation from the world origin.
  const cameraModeRef = React.useRef(cameraMode);
  const pickModeRef = React.useRef(pickMode);
  const targetPoseRef = React.useRef<SmoothPose | null>(null);
  const renderedPoseRef = React.useRef<SmoothPose | null>(null);

  /**
   * Where the robot model is drawn *instead of* the reported pose, while an
   * initial-pose drag is in flight. Null the rest of the time.
   *
   * A ref rather than state because the render loop reads it every frame; the
   * pointer handlers already hold the same drag in `draft` for the marker.
   */
  const posePreviewRef = React.useRef<SmoothPose | null>(null);

  // The stored-vertex layer and the marker currently lit under the pointer.
  // `hoverIdRef` is the scene's copy and drives the highlight at pointer rate;
  // the state alongside it exists only so the cursor can become a pointer, which
  // is a render — hence two, rather than one read at two speeds.
  const vertexLayerRef = React.useRef<VertexLayer | null>(null);
  const hoverIdRef = React.useRef<string | null>(null);
  /** Mirrors `movingVertex` for the layer effect, which rebuilds around it. */
  const movingIdRef = React.useRef<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = React.useState<MapVertex | null>(
    null,
  );

  // Joint articulation. The GLB keeps URDF link names as node names, so each
  // joint resolves to the child-link Object3D it rotates. Nodes belong to the
  // module-cached model instance, so the resolved map stays valid across scene
  // rebuilds — resolve once, on first model attach. `latestJointsRef` buffers
  // the newest joints so angles that arrive while the model is still loading
  // are applied as soon as it lands (mirrors targetPoseRef for the body pose).
  const jointNodesRef = React.useRef<Map<
    string,
    { node: THREE.Object3D; axis: THREE.Vector3 }
  > | null>(null);
  const latestJointsRef = React.useRef<Record<string, number> | undefined>(
    undefined,
  );

  const applyJoints = React.useCallback(() => {
    const nodes = jointNodesRef.current;
    const target = latestJointsRef.current;
    if (!nodes || !target) return;
    for (const [name, q] of Object.entries(target)) {
      const joint = nodes.get(name);
      if (!joint) {
        if (!warnedUnknownJoints.has(name)) {
          warnedUnknownJoints.add(name);
          console.warn(`unknown joint "${name}" — not in G23_JOINTS / the GLB`);
        }
        continue;
      }
      // The GLB is baked at the URDF zero configuration with identity joint
      // rotations (no rpy on any joint origin), so q is absolute: overwrite
      // the quaternion, leave the baked position (the joint origin) alone.
      joint.node.quaternion.setFromAxisAngle(joint.axis, q);
    }
  }, []);

  /**
   * Record where the robot should be. The render loop walks the drawn pose
   * toward it; nothing here touches the scene, so it is safe to call while a
   * rebuild is in flight.
   */
  const setTargetPose = React.useCallback((next: RobotPose) => {
    const yaw = (next.theta * Math.PI) / 180;
    const cur = renderedPoseRef.current;
    targetPoseRef.current = {
      x: next.x,
      y: next.y,
      z: next.z,
      // Unwrap against the drawn yaw so the ease takes the short way round:
      // 359deg -> 1deg has to be +2deg, not a -358deg spin in place.
      yaw: cur
        ? yaw + Math.round((cur.yaw - yaw) / (2 * Math.PI)) * 2 * Math.PI
        : yaw,
    };
  }, []);

  // The live feed, when one was given. In a ref so a frame loop can read it
  // without the loop's effect depending on the prop.
  const telemetryRef = React.useRef(telemetry);
  React.useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);
  /** The last pose object taken off the feed, compared by identity. */
  const feedPoseRef = React.useRef<RobotPose | undefined>(undefined);

  /**
   * Drain the live feed, once per drawn frame rather than once per message.
   *
   * Polling a 20 Hz feed from a 60 Hz loop reads each frame about three times,
   * which is why both channels are guarded on object identity: the stream hands
   * out a fresh object per message, so "unchanged" is one comparison and costs
   * nothing. The alternative — a subscription that pushes — would buy an
   * earlier reaction by at most one frame and would need its own teardown.
   */
  const pumpTelemetry = React.useCallback(() => {
    const feed = telemetryRef.current;
    if (!feed) return;

    const nextPose = feed.pose.current;
    if (nextPose && nextPose !== feedPoseRef.current) {
      feedPoseRef.current = nextPose;
      setTargetPose(nextPose);
    }

    const nextJoints = feed.joints.current;
    if (nextJoints && nextJoints !== latestJointsRef.current) {
      latestJointsRef.current = nextJoints;
      applyJoints();
    }
  }, [setTargetPose, applyJoints]);

  // ---- Scene setup (rebuilds on map / theme change) --------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const widthM = meta ? meta.width * meta.resolution : DEFAULT_SPAN_M;
    const heightM = meta ? meta.height * meta.resolution : DEFAULT_SPAN_M;
    const centerX = meta ? meta.origin[0] + widthM / 2 : 0;
    const centerY = meta ? meta.origin[1] + heightM / 2 : 0;

    // Set by dispose() below. Two async loads — the GLB and the ground texture
    // — can land after this scene has been torn down by a theme toggle or a map
    // change, and each has to check it before touching anything.
    let cancelled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.background);

    // z-up world so ROS map coordinates (x, y, z) map straight through.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    const span = Math.max(widthM, heightM);
    camera.position.set(centerX, centerY - span * 0.6, span * 0.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(centerX, centerY, 0);
    controls.enableDamping = true;
    // Left-button behaviour tracks the camera mode; the dedicated mode effect
    // keeps this in sync, but seed it here so a scene rebuild preserves it.
    applyCameraMode(
      controls,
      cameraModeRef.current,
      pickModeRef.current !== null,
    );
    controls.update();

    // Ground plane textured with the 2D occupancy grid for spatial context.
    // Only drawn when a 2D map is available; a raw cloud test skips it.
    let groundTexture: THREE.Texture | null = null;
    if (meta) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(widthM, heightM),
        new THREE.MeshBasicMaterial({
          color: theme.ground,
          transparent: true,
          opacity: theme.groundOpacity,
          side: THREE.DoubleSide,
        }),
      );
      ground.position.set(centerX, centerY, 0);
      scene.add(ground);

      if (mapImageUrl) {
        new THREE.TextureLoader().load(mapImageUrl, (texture) => {
          // A rebuild that lands mid-download leaves this callback holding a
          // texture for a material that is already disposed. Nothing else would
          // ever free it, and nothing would ever draw it either.
          if (cancelled) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          // Kept so dispose() can free it: the teardown traverse below walks
          // materials, and a material does not dispose the textures it points
          // at. Every theme toggle used to leak one of these.
          groundTexture = texture;
          const mat = ground.material as THREE.MeshBasicMaterial;
          mat.map = texture;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        });
      }
    }

    // Live body_cloud: preallocated dynamic buffers, drawn up to drawRange.
    const liveGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_LIVE_POINTS * 3);
    const colors = new Float32Array(MAX_LIVE_POINTS * 3);
    liveGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    liveGeom.setAttribute(
      "color",
      new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
    );
    liveGeom.setDrawRange(0, 0);
    const livePoints = new THREE.Points(
      liveGeom,
      new THREE.PointsMaterial({ size: LIVE_POINT_SIZE, vertexColors: true }),
    );
    livePoints.frustumCulled = false;
    scene.add(livePoints);

    // The robot is the only lit object in the scene — the ground, both clouds
    // and the old marker are all unlit — so these lights exist solely to give
    // it readable form. The hemisphere fill keeps its underside off pure black
    // and the directional key rakes across the body from the default camera
    // side, which is what makes the leg geometry legible.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(-1, -1.5, 3);
    scene.add(keyLight);

    // Pose markers: the committed goal, the staged initial pose, and the
    // lighter one that follows the drag (recoloured per pick mode). All start
    // hidden; the marker effect below places them and re-runs after a scene
    // rebuild, so a rebuild mid-drag does not lose them.
    const goalMarker = createPoseMarker(theme.goal, 1);
    const initialPoseMarker = createPoseMarker(theme.initialPose, 1);
    const draftMarker = createPoseMarker(theme.goalDraft, 0.55);
    scene.add(goalMarker);
    scene.add(initialPoseMarker);
    scene.add(draftMarker);

    const robotGroup = new THREE.Group();
    // Hidden until the first pose arrives (a raw cloud test has no /robot/state).
    robotGroup.visible = false;
    scene.add(robotGroup);

    // Attach the shared model once it resolves. `cancelled` guards a scene
    // rebuild that lands mid-load: Object3D.add() reparents, so a stale
    // callback would steal the model out of the group the new scene just built.
    loadRobotModel()
      .then((model) => {
        if (cancelled) return;
        model.position.z = ROBOT_BASE_HEIGHT_M;
        robotGroup.add(model);
        // Resolve joint -> child-link nodes once; the map survives scene
        // rebuilds because the nodes belong to the cached model.
        if (!jointNodesRef.current) {
          const nodes = new Map<
            string,
            { node: THREE.Object3D; axis: THREE.Vector3 }
          >();
          for (const [name, spec] of G23_JOINTS) {
            const node = model.getObjectByName(spec.childLink);
            if (node) {
              nodes.set(name, { node, axis: spec.axis });
            } else {
              console.warn(
                `joint "${name}": link node "${spec.childLink}" missing from GLB`,
              );
            }
          }
          jointNodesRef.current = nodes;
        }
        applyJoints();
      })
      .catch((err) => console.error("robot model failed to load", err));

    // The canvas's client rect, cached. castFromPointer runs on every
    // pointermove and a drag re-renders this component (the draft marker is
    // state), so reading it live would force a layout on each move. The cache
    // lives in this closure rather than in a component ref because it describes
    // *this* renderer and has to die with it — and because a ref an effect
    // touches may not be written from a callback.
    let cachedRect: DOMRect | null = null;
    const invalidateRect = () => {
      cachedRect = null;
    };
    canvasRectRef.current = (fresh) => {
      if (fresh) cachedRect = null;
      return (cachedRect ??= renderer.domElement.getBoundingClientRect());
    };

    const resize = () => {
      invalidateRect();
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    // A scroll moves the canvas in client coordinates without resizing it, and
    // below `lg` this page scrolls. Capture phase because the scroller is an
    // ancestor and scroll does not bubble; passive because this only ever
    // drops a cached value.
    window.addEventListener("scroll", invalidateRect, {
      capture: true,
      passive: true,
    });

    /**
     * Advance the drawn pose toward the reported one by one frame.
     *
     * The exponential factor is derived from dt rather than applied per frame,
     * so a 120 Hz display converges at the same wall-clock rate as a 60 Hz one
     * (and a tab restored after minutes in the background lands on a large dt,
     * i.e. snaps — which is the right answer, the robot really has moved).
     */
    const stepPose = (dt: number) => {
      const target = targetPoseRef.current;
      let cur = renderedPoseRef.current;

      if (target) {
        if (cur) {
          const a = 1 - Math.exp(-dt / POSE_EASE_TAU_S);
          const dx = (target.x - cur.x) * a;
          const dy = (target.y - cur.y) * a;
          const dz = (target.z - cur.z) * a;
          cur.x += dx;
          cur.y += dy;
          cur.z += dz;
          cur.yaw += (target.yaw - cur.yaw) * a;

          // Focus mode: shift the camera by the same delta so the viewing offset
          // (and any orbit the user set) survives while the robot moves. This
          // used to run per pose update, which made the 1 Hz jump doubly
          // obvious — the whole view lurched, not just the robot.
          if (cameraModeRef.current === "focus") {
            camera.position.x += dx;
            camera.position.y += dy;
            camera.position.z += dz;
          }
        } else {
          // First fix: snap, so the robot does not fly in from the world origin.
          cur = renderedPoseRef.current = { ...target };
        }
      }

      // Focus mode tracks the *reported* pose even mid-drag: the camera follows
      // the machine, not the estimate being placed. Easing above also keeps
      // running through a drag, so releasing it hands the model back to a
      // current pose rather than to wherever the robot was when the drag began.
      if (cur && cameraModeRef.current === "focus") {
        controls.target.set(cur.x, cur.y, cur.z);
      }

      // An initial-pose drag draws the robot at the dragged pose instead — no
      // easing, so the model tracks the pointer 1:1 the way a dragged object
      // has to. Until either exists there is nothing to draw (a raw cloud test
      // with no pose feed).
      const drawn = posePreviewRef.current ?? cur;
      if (!drawn) return;
      robotGroup.position.set(drawn.x, drawn.y, drawn.z);
      robotGroup.rotation.z = drawn.yaw;
      robotGroup.visible = true;
    };

    let raf = 0;
    let prevFrameMs = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = (now - prevFrameMs) / 1000;
      prevFrameMs = now;

      // Before the ease, so a frame that just arrived is the one this frame
      // walks toward rather than the one before it.
      pumpTelemetry();
      stepPose(dt);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);

    const dispose = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("scroll", invalidateRect, { capture: true });
      controls.dispose();
      renderer.dispose();
      // Detach the robot before the sweep below. The model is cached across
      // scene rebuilds (theme / map changes), so letting the traverse dispose
      // its geometry would leave every later mount with an empty group.
      robotGroup.clear();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      // By hand, because the traverse above never reaches the texture a
      // material points at — the same gap the vertex layer's badge textures
      // have their own dispose for.
      groundTexture?.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      liveGeom,
      mapPoints: null,
      streamedMapPoints: null,
      mapFrame: meta ? { cx: centerX, cy: centerY, widthM, heightM } : null,
      goalMarker,
      initialPoseMarker,
      draftMarker,
      dispose,
    };

    // Re-apply the held streamed map frame: the rebuild this effect just did
    // disposed the old layer, and the stream's next frame is seconds away.
    // Running through applyMapStreamFrame also re-tints it for a theme change.
    if (mapStreamFrameRef.current) {
      applyMapStreamFrame(mapStreamFrameRef.current);
    }

    return () => {
      dispose();
      sceneRef.current = null;
    };
  }, [
    meta,
    mapImageUrl,
    resolvedTheme,
    applyJoints,
    applyMapStreamFrame,
    pumpTelemetry,
  ]);

  // ---- Live body_cloud stream (independent of scene rebuilds) ----------
  // The WebSocket is opened once on mount and closed on unmount. Each frame is
  // written into whatever live geometry the scene-setup effect currently owns
  // (via sceneRef), so map loads and theme changes rebuild the scene without
  // tearing down the socket. Previously the stream lived in the setup effect,
  // so an async map load closed the still-connecting WS and logged
  // "WebSocket is closed before the connection is established".
  React.useEffect(() => {
    const color = new THREE.Color();
    const applyFrame = (frame: PointCloudFrame) => {
      const ctx = sceneRef.current;
      if (!ctx) return;
      const posAttr = ctx.liveGeom.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      const colAttr = ctx.liveGeom.getAttribute(
        "color",
      ) as THREE.BufferAttribute;
      const n = Math.min(frame.count, MAX_LIVE_POINTS);
      const src = frame.positions;
      const dstPos = posAttr.array as Float32Array;
      const dstCol = colAttr.array as Float32Array;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        dstPos[j] = src[j];
        dstPos[j + 1] = src[j + 1];
        dstPos[j + 2] = src[j + 2];
        heightColor(src[j + 2], color);
        dstCol[j] = color.r;
        dstCol[j + 1] = color.g;
        dstCol[j + 2] = color.b;
      }
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      ctx.liveGeom.setDrawRange(0, n);
    };

    const stream = createPointCloudStream({
      onFrame: applyFrame,
      onStatus: (s) => onStatusRef.current?.(s),
    });
    return () => stream.close();
  }, []);

  // ---- Streamed "map so far" cloud (mapping runs) ------------------------
  // Same socket-outside-the-scene-effect shape as the live stream above, same
  // reason. Deps are [mapCloudStream] alone: the frame applier is reached
  // through its ref so a theme change never bounces the socket.
  React.useEffect(() => {
    if (!mapCloudStream) {
      // Turned off (or never on): drop the held frame and the drawn layer, so
      // re-enabling starts clean and a toggled-off layer is not resurrected by
      // the next scene rebuild's re-apply.
      mapStreamFrameRef.current = null;
      const ctx = sceneRef.current;
      if (ctx?.streamedMapPoints) {
        ctx.scene.remove(ctx.streamedMapPoints);
        ctx.streamedMapPoints.geometry.dispose();
        (ctx.streamedMapPoints.material as THREE.Material).dispose();
        ctx.streamedMapPoints = null;
      }
      return;
    }

    const stream = createPointCloudStream(
      {
        onFrame: (frame) => {
          mapStreamFrameRef.current = frame;
          applyMapStreamFrameRef.current(frame);
        },
        onStatus: (s) => onMapStatusRef.current?.(s),
      },
      "/api/v1/robot/pointcloud/map/stream",
    );
    return () => stream.close();
  }, [mapCloudStream]);

  // ---- Camera mode (move / focus) --------------------------------------
  // Re-runs on a scene rebuild (meta / theme) too, so the mode survives a
  // renderer teardown.
  React.useEffect(() => {
    cameraModeRef.current = cameraMode;
    const ctx = sceneRef.current;
    if (!ctx) return;
    applyCameraMode(ctx.controls, cameraMode, pickModeRef.current !== null);
    // Entering focus: frame the robot from a fixed offset behind and above it.
    if (cameraMode === "focus" && renderedPoseRef.current) {
      const p = renderedPoseRef.current;
      ctx.controls.target.set(p.x, p.y, p.z);
      ctx.camera.position.set(p.x, p.y - 8, p.z + 6);
    }
    ctx.controls.update();
  }, [cameraMode, meta, mapImageUrl, resolvedTheme]);

  // ---- Top-down view (one-shot) ----------------------------------------
  // Deliberately not a dep of the camera-mode effect above and deliberately not
  // re-run on a scene rebuild: this answers a button press, and a map load or a
  // theme toggle re-framing the camera would throw away a view the operator set
  // by hand. The nonce is the only thing that triggers it.
  React.useEffect(() => {
    if (!topDownNonce) return;
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { camera, controls, mapFrame } = ctx;

    // Focus mode's target is the robot and the render loop keeps writing it, so
    // there the only choice left is the height — and the current one is the
    // operator's own zoom, which a "look from above" should not discard.
    // Otherwise a map to frame beats wherever the view had been panned to:
    // the whole point of going overhead is to see the site, not the corner of
    // it that happened to be under the camera.
    const framing = cameraModeRef.current !== "focus" ? mapFrame : null;
    if (framing) controls.target.set(framing.cx, framing.cy, 0);

    const height = framing
      ? overheadDistance(camera, framing.widthM, framing.heightM)
      : camera.position.distanceTo(controls.target);

    camera.position.set(
      controls.target.x,
      // Not exactly overhead — see TOP_DOWN_TILT.
      controls.target.y - height * TOP_DOWN_TILT,
      controls.target.z + height,
    );
    controls.update();
  }, [topDownNonce]);

  // ---- Pick mode: hand the left button over ----------------------------
  // Separate from the effect above (which also re-frames the camera when focus
  // mode is entered — arming a pick must not jolt the view). `cameraMode` is a
  // dep so the button mapping is re-asserted after that effect rewrites it.
  React.useEffect(() => {
    pickModeRef.current = pickMode;
    const ctx = sceneRef.current;
    if (!ctx) return;
    applyCameraMode(ctx.controls, cameraModeRef.current, pickMode !== null);
  }, [pickMode, cameraMode, meta, mapImageUrl, resolvedTheme]);

  // ---- Pose markers (no scene rebuild) ---------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];

    placePoseMarker(ctx.goalMarker, goal);
    placePoseMarker(ctx.initialPoseMarker, initialPose);

    // The draft belongs to whichever mode is armed, in that mode's hue — the
    // arrow has to say which pose is being placed while it is being placed, not
    // once it lands in a readback panel. Leaving the mode mid-drag must not
    // strand a marker on the map, hence the null.
    setMarkerColor(
      ctx.draftMarker,
      pickMode === "initial-pose" ? theme.initialPoseDraft : theme.goalDraft,
    );
    placePoseMarker(ctx.draftMarker, pickMode ? draft : null);
  }, [goal, initialPose, draft, pickMode, meta, mapImageUrl, resolvedTheme]);

  // ---- Initial-pose pick: the robot itself is the preview ----------------
  // An initial pose asserts where the machine *is*, so the machine is what
  // moves: arming the mode takes the robot off the reported pose and hands it to
  // the pointer, a press plants it, the drag turns it to face where it faces.
  // That makes the gesture self-describing — what stands on the floor at release
  // is exactly what gets published — which is why this flow needs no confirm.
  //
  // A goal pick deliberately does not do this. A goal is somewhere to go, not a
  // claim about the present, and moving the robot to preview one would state
  // something false; the arrow marker is the whole of that preview.
  React.useEffect(() => {
    if (pickMode !== "initial-pose" || !draft) {
      posePreviewRef.current = null;
      return;
    }
    posePreviewRef.current = {
      x: draft.x,
      y: draft.y,
      // Whatever height the robot is already drawn at — the pose feed is planar
      // (lio_bridge reports z ~ 0), so this keeps it on the same floor rather
      // than guessing a new one — plus the lift while it is still in hand.
      z: (renderedPoseRef.current?.z ?? 0) + (carrying ? CARRY_LIFT_M : 0),
      yaw: (draft.theta * Math.PI) / 180,
    };
  }, [draft, carrying, pickMode]);

  // ---- Stored map vertices (toggle) ------------------------------------
  // The layer is reached into after it is built — hover recolours a marker on
  // every pointer move — so it is held in a ref rather than being rebuilt.
  // `hoverIdRef` mirrors the id the layer is currently showing, so a rebuild
  // (map swap, theme toggle) can restore the highlight, and so a pointer move
  // that stays on the same marker costs one comparison and no React render.
  //
  // The layer itself is rebuilt rather than diffed, so it needs no slot in
  // sceneRef: the group is created here and this effect's own cleanup takes it
  // back out. The scene-rebuild deps (meta / mapImageUrl / theme) are listed for
  // the same reason the marker effect lists them — a rebuild drops the old
  // scene, and without them the layer would never be re-added to the new one.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showVertices || !vertices?.length) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const layer = createVertexLayer(vertices, theme);
    ctx.scene.add(layer.group);
    vertexLayerRef.current = layer;
    // A theme toggle under a resting pointer must not drop the highlight, and a
    // list patched by a re-place rebuilds this layer mid-gesture: both ids
    // survive the rebuild even though the objects wearing them do not.
    layer.setHovered(hoverIdRef.current);
    layer.setMoving(movingIdRef.current);

    return () => {
      // `ctx.scene` may already be the discarded scene by the time this runs
      // (the setup effect's cleanup goes first); removing from it is harmless
      // either way, and the dispose is what actually matters — the teardown
      // traverse frees geometries and materials but never the badge textures.
      ctx.scene.remove(layer.group);
      layer.dispose();
      vertexLayerRef.current = null;
    };
  }, [vertices, showVertices, meta, mapImageUrl, resolvedTheme]);

  // A stop in the operator's hands comes off the map. Its own effect rather than
  // a dep of the one above: arming a re-place must not rebuild the layer, and
  // the build effect re-applies this from the ref after a rebuild anyway.
  React.useEffect(() => {
    movingIdRef.current = movingVertex?.id ?? null;
    vertexLayerRef.current?.setMoving(movingIdRef.current);
  }, [movingVertex]);

  // ---- Planned path band ------------------------------------------------
  // Same shape as the vertex layer above — built wholesale, removed and disposed
  // by this effect's own cleanup, so it needs no slot in sceneRef. It also lists
  // the scene-rebuild deps for the same reason: a rebuild drops the old scene,
  // and without them the band would never be added to the new one.
  //
  // Depending on `path` (a fresh object per frame) is what makes each new route
  // replace the last, and the empty-points sample from the backend is what
  // erases it: the guard below fails, so the cleanup runs and nothing takes its
  // place. There is deliberately nothing here that decides when a route is over.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showPath || !path || path.points.length < 4) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const ribbon = createPathRibbon(path.points, theme);
    if (!ribbon) return;
    ctx.scene.add(ribbon.mesh);

    return () => {
      // `ctx.scene` may already be the discarded scene here (the setup effect's
      // cleanup goes first); the remove is harmless either way and the dispose
      // is what matters, same as the vertex layer.
      ctx.scene.remove(ribbon.mesh);
      ribbon.dispose();
    };
  }, [path, showPath, meta, mapImageUrl, resolvedTheme]);

  // ---- Optional static map cloud (toggle) ------------------------------
  //
  // `meta` and `mapImageUrl` are dependencies although nothing here reads them:
  // they rebuild the scene, and this layer has to be re-added to the new one.
  // Without them a grid appearing for the map already on screen disposed these
  // points with the old scene and left the toggle lit over nothing. The path
  // ribbon above carries the same two for the same reason.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showMapCloud || !mapName) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const abort = new AbortController();
    // Held so the cleanup can undo exactly what this run added. The removal
    // used to live at the top of the *next* run, which meant a run that never
    // came — the toggle going off while a rebuild was in flight — left the
    // points in the scene with nothing tracking them.
    let added: THREE.Points | null = null;

    fetchMapPointCloud(mapName, { signal: abort.signal })
      .then((frame) => {
        // `sceneRef.current !== ctx` is the download landing after a rebuild:
        // adding to the discarded scene would draw nothing and leak both
        // buffers.
        if (abort.signal.aborted || sceneRef.current !== ctx) return;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute(
          "position",
          new THREE.BufferAttribute(frame.positions, 3),
        );
        // Solid map-cloud colour (white on dark, dark-grey on light) keeps it
        // visually distinct from the height-coloured live body cloud.
        const points = new THREE.Points(
          geom,
          new THREE.PointsMaterial({
            size: MAP_POINT_SIZE,
            color: theme.mapCloud,
            opacity: 0.6,
            transparent: true,
          }),
        );
        points.frustumCulled = false;
        added = points;
        ctx.mapPoints = points;
        ctx.scene.add(points);
      })
      .catch((err) => {
        if (!abort.signal.aborted) console.error(err);
      });

    return () => {
      abort.abort();
      if (!added) return;
      // `ctx.scene` may already be the discarded scene here, since the setup
      // effect's cleanup runs first; the remove is harmless either way and the
      // dispose is what matters, same as the path ribbon.
      ctx.scene.remove(added);
      added.geometry.dispose();
      (added.material as THREE.Material).dispose();
      if (ctx.mapPoints === added) ctx.mapPoints = null;
    };
  }, [showMapCloud, mapName, meta, mapImageUrl, resolvedTheme]);

  // ---- Pose picking -----------------------------------------------------
  // The anchor is the ground point the press landed on, kept alongside the raw
  // pointer position so the heading deadzone can be measured in screen pixels:
  // a metric deadzone would be enormous at the far end of a perspective view
  // and vanishingly small up close.
  const anchorRef = React.useRef<{
    wx: number;
    wy: number;
    cx: number;
    cy: number;
  } | null>(null);
  // Lazily constructed: a useRef initialiser argument is evaluated (then thrown
  // away) on every render, and a Raycaster is not free to build.
  const raycasterRef = React.useRef<THREE.Raycaster | null>(null);
  /**
   * Reads the canvas's client rect through the scene's own cache, or null
   * before the renderer exists. Installed by the setup effect below.
   */
  const canvasRectRef = React.useRef<
    ((fresh?: boolean) => DOMRect) | null
  >(null);

  /** Aim the shared raycaster through a pointer position, or null off-canvas. */
  const castFromPointer = (event: { clientX: number; clientY: number }) => {
    const ctx = sceneRef.current;
    if (!ctx) return null;
    // Through the scene's cache, dropped by its ResizeObserver and by any
    // ancestor scroll — the two things that move the canvas in client
    // coordinates — and refilled on the first cast after either.
    const rect = canvasRectRef.current?.();
    if (!rect || rect.width === 0 || rect.height === 0) return null;

    const raycaster = (raycasterRef.current ??= new THREE.Raycaster());
    aimRaycaster(raycaster, ctx.camera, rect, event.clientX, event.clientY);
    return raycaster;
  };

  /** Project a pointer position onto the z=0 map plane. */
  const pickGround = (event: React.PointerEvent) => {
    const raycaster = castFromPointer(event);
    return raycaster ? intersectGround(raycaster) : null;
  };

  /**
   * The stored vertex under a pointer position, or null.
   *
   * A real raycast against the layer, not a distance test against projected
   * screen positions: the markers stand on the floor of a perspective view, so
   * "near the pointer" only means anything after the projection the raycaster is
   * already doing. Hidden layer, no hits — the ref is null.
   */
  const pickVertex = (event: { clientX: number; clientY: number }) => {
    const layer = vertexLayerRef.current;
    if (!layer) return null;
    const raycaster = castFromPointer(event);
    if (!raycaster) return null;
    const hit = raycaster.intersectObjects(layer.pickables, false)[0];
    const id = hit?.object.userData.vertexId as string | undefined;
    return id ? (layer.byId.get(id) ?? null) : null;
  };

  /** Light the marker under the pointer, or clear the highlight. */
  const hoverVertex = (vertex: MapVertex | null) => {
    const id = vertex?.id ?? null;
    // Told every time, not only on a change: setHovered is self-deduping, and
    // going through it unconditionally is what re-lights a marker whose layer
    // was rebuilt while the pointer sat still on it.
    vertexLayerRef.current?.setHovered(id);
    if (id === hoverIdRef.current) return;
    hoverIdRef.current = id;
    setHoveredVertex(vertex);
  };

  /**
   * The planner can only plan inside the occupancy grid, and the localizer can
   * only match against the map it loaded, so a press that lands on floor beyond
   * the map must not become a pose. With no 2D map loaded there is nothing to
   * bound against, so any ground point is accepted.
   */
  const insideMap = (wx: number, wy: number) => {
    if (!meta) return true;
    const [x0, y0] = meta.origin;
    return (
      wx >= x0 &&
      wx <= x0 + meta.width * meta.resolution &&
      wy >= y0 &&
      wy <= y0 + meta.height * meta.resolution
    );
  };

  /**
   * The heading a draft starts at, before any drag aims it.
   *
   * A re-place starts from the stop's own heading rather than the robot's: the
   * gesture is about where that stop is, and a plain click to nudge it half a
   * metre must not silently spin it to face wherever the machine happens to be
   * pointing. The other two modes keep the robot's heading, which is the sane
   * default when the pose being placed is the robot's own.
   */
  const seedTheta = () =>
    draft?.theta ??
    (pickMode === "vertex"
      ? movingVertex?.theta
      : // Off the feed rather than a prop, and read here rather than kept in
        // state: this runs on a press, so "the robot's heading" means the one
        // it has at the moment the gesture starts.
        telemetryRef.current?.pose.current?.theta) ??
    0;

  const handlePointerDown = (event: React.PointerEvent) => {
    // Re-measure on every press, whatever the press turns out to mean.
    //
    // The cache's two invalidations — a resize and an ancestor scroll — miss
    // the canvas being *translated* without either: a banner or a status row
    // appearing above a fixed-height viewport moves it in client coordinates
    // and a ResizeObserver says nothing. A stale rect there would put a
    // commanded pose at an offset from where the operator clicked, which is
    // the one way this can be wrong that matters. A press is both the start of
    // every pick and rare enough to pay a layout read for; the drag that
    // follows cannot move the canvas, since the pointer is captured.
    canvasRectRef.current?.(true);
    if (!pickMode || event.button !== 0) return;
    const hit = pickGround(event);
    if (!hit || !insideMap(hit.wx, hit.wy)) return;
    anchorRef.current = { ...hit, cx: event.clientX, cy: event.clientY };
    // Capture on the canvas, not on this container: OrbitControls captures the
    // same pointer on the canvas itself, and capturing further up the tree
    // would steal it and strand OrbitControls' pointerup handler.
    sceneRef.current?.renderer.domElement.setPointerCapture(event.pointerId);
    // The press plants what was being carried: same spot, on the floor now.
    setCarrying(false);
    // Until the pointer moves, keep the heading it was carried at (the seed, on
    // the first press) so a plain click still yields a sane pose instead of
    // snapping to 0deg.
    setDraft({ x: hit.wx, y: hit.wy, theta: seedTheta() });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!pickMode) {
      // Hover-testing the vertex layer is the *only* thing a bare pointer move
      // does here. Skipped with a button down: that is a camera drag, and
      // lighting up markers the view is sweeping past says the pointer is over
      // something when it is really just orbiting.
      if (event.buttons === 0) hoverVertex(pickVertex(event));
      return;
    }
    // A pose is being placed, so nothing on the map is a target — and leaving a
    // marker lit under a crosshair would offer a second meaning for a gesture
    // that already has one.
    hoverVertex(null);

    const anchor = anchorRef.current;

    // No press yet: carry the pose under the pointer, keeping the heading. Goal
    // mode alone does not — an arrow trailing the cursor with nothing committed
    // would read as a goal that is already set. The other two are *moving*
    // something that exists (the robot, or a stored stop), so seeing it follow
    // the pointer before the press is the whole point. A cursor over ground
    // outside the map carries nothing, for the same reason a press there does
    // not plant: it could not be published.
    if (!anchor) {
      if (pickMode === "goal") return;
      const hit = pickGround(event);
      if (!hit || !insideMap(hit.wx, hit.wy)) {
        setDraft(null);
        return;
      }
      setCarrying(true);
      setDraft({ x: hit.wx, y: hit.wy, theta: seedTheta() });
      return;
    }

    // Planted: the position is fixed at the anchor and the drag only aims.
    // Keep whatever heading the draft already has inside the deadzone.
    let theta = seedTheta();
    const dragPx = Math.hypot(
      event.clientX - anchor.cx,
      event.clientY - anchor.cy,
    );
    if (dragPx >= HEADING_DEADZONE_PX) {
      // World-space angle from the anchor to wherever the drag now points at
      // the floor. This cannot come from the screen delta: the camera may be
      // looking at the map from any azimuth (or from below), so screen-right is
      // not world +x.
      const hit = pickGround(event);
      if (hit) {
        const dx = hit.wx - anchor.wx;
        const dy = hit.wy - anchor.wy;
        if (dx !== 0 || dy !== 0) theta = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
    }
    setDraft({ x: anchor.wx, y: anchor.wy, theta });
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!anchorRef.current) return;
    anchorRef.current = null;
    const canvas = sceneRef.current?.renderer.domElement;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (draft && pickMode) onPickCommit?.(draft);
    setDraft(null);
    setCarrying(false);
  };

  // The pointer leaving the viewport takes the carried robot with it, rather
  // than stranding it wherever it was last seen — the operator moving onto the
  // control panel has not chosen that spot. A press in flight is unaffected:
  // the canvas holds the pointer capture, so the drag survives.
  //
  // This is also what clears the draft on disarm, and why no effect watches
  // pickMode to do it: the disarm button is off-canvas, so reaching it means
  // passing through here first. Both the marker and preview effects gate on
  // pickMode anyway, so a draft left in state is never drawn.
  const handlePointerLeave = () => {
    hoverVertex(null);
    if (anchorRef.current) return;
    setDraft(null);
    setCarrying(false);
  };

  /**
   * Double-click a stored vertex to ask about it. Ignored while a pick mode is
   * armed — the two presses of the double-click have already staged and
   * committed a pose by the time this fires, and a dialog on top of that would
   * be asking about the wrong thing.
   */
  const handleDoubleClick = (event: React.MouseEvent) => {
    if (pickMode || !onVertexActivate) return;
    const vertex = pickVertex(event);
    if (vertex) onVertexActivate(vertex);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden",
        pickMode && "cursor-crosshair touch-none",
        // Nothing else on this canvas is clickable, so the cursor is the only
        // thing that says a marker is.
        !pickMode && hoveredVertex && "cursor-pointer",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleDoubleClick}
    />
  );
}
