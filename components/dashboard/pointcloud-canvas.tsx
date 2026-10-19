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
  FRONT_DEFAULT_Z,
  TOP_DOWN_TILT,
  applyCameraMode,
  dollyStep,
  frameMap,
  frontView,
  frontViewAround,
  overheadDistance,
  type MapFrame,
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
import { createDockLayer } from "@/lib/scene/dock-layer";
import { EDL_LAYER, createEdlPass, type EdlPass } from "@/lib/scene/edl";
import {
  createDashedRibbon,
  createPathRibbon,
  type PathRibbon,
} from "@/lib/scene/path-ribbon";
import { aimRaycaster, intersectGround } from "@/lib/scene/picking";
import { GROUND_FLOOR_Z_M, drawnGround } from "@/lib/map/floors";
import { columnAt } from "@/lib/map/ground-fill";
import { POSE_EASE_TAU_S, type SmoothPose } from "@/lib/scene/pose";
import {
  ROBOT_BASE_HEIGHT_M,
  loadRobotModel,
  warnedUnknownJoints,
} from "@/lib/scene/robot-model";
import { THEMES } from "@/lib/scene/theme";
import {
  createVoxelLayer,
  thinGroundUnderVoxels,
  type VoxelLayer,
} from "@/lib/scene/voxel-layer";
import { createZoneLayer } from "@/lib/scene/zone-layer";
import {
  createVertexLayer,
  type VertexLayer,
} from "@/lib/scene/vertex-layer";
import { headingDegrees, isDrag } from "@/lib/map/gesture";
import type { MapVertex, ZonePolygon } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type {
  MapMetadata,
  PlanarPose,
  PlannedPath,
  RobotPose,
} from "@/lib/types/robot";
import type { PointCloudFrame } from "@/lib/types/pointcloud";
import type { StreamStatus } from "@/lib/types/stream";
import { createPointCloudStream } from "@/lib/ros/pointcloud-stream";

// Height (metres) the robot floats at while carried on the pointer, so a held
// robot does not read as a pose already set. Small enough to stay lined up with
// the marker ring on the floor below it.
const CARRY_LIFT_M = 0.35;

/**
 * The kinds of pose a drag on the viewport can produce.
 *
 * "vertex" re-places an existing stop, so the canvas also needs `movingVertex`
 * to take that marker off the map while it is in hand. "place" is a new stop:
 * the same carry / press / drag gesture, handed up on release. It is a mode
 * rather than a tap because a new stop needs a heading, and only a drag gives
 * one.
 */
export type PickMode = "goal" | "initial-pose" | "vertex" | "place";

interface PointCloudCanvasProps {
  /** 2D map metadata; when omitted the cloud renders with no ground plane. */
  meta?: MapMetadata;
  /**
   * Ground-plane texture URL (GET /api/v1/maps/{name}/image via apiUrl()). A
   * real URL rather than a data URI so the browser can revalidate its ETag.
   */
  mapImageUrl?: string;
  /**
   * Pose and joints, drained once per drawn frame. A feed rather than props
   * because the socket lands ~40 messages a second and a prop is a render.
   * Omitted leaves the robot hidden.
   */
  telemetry?: TelemetryFeed;
  /**
   * A stored map's scan to draw under the live one; null draws none. Fetched by
   * useMapPointCloud so its refusal reaches a screen.
   */
  mapCloud?: PointCloudFrame | null;
  /**
   * A stored map's 3D map, decoded; null draws none. Fetched by useMapOctomap
   * for `mapCloud`'s reason. With no floor plan it is also what Recenter and
   * Top down frame.
   */
  voxels?: OccupiedVoxels | null;
  /**
   * The heights of the 3D map to draw, metres, `[lo, hi)`: one floor of a
   * map that spans several. Null draws them all. Moving it never rebuilds
   * the layer (see VoxelLayer.setBand).
   */
  voxelBand?: { lo: number; hi: number } | null;
  /**
   * The ground height a pick lands at, metres: the floor shown, so a goal or
   * a waypoint placed with 2F up is on 2F. 0 is the ground floor, bounded by
   * the floor plan; any other height is bounded by the 3D map's box, since
   * the floor plan need not reach over an upper storey.
   */
  pickZ?: number;
  /**
   * The planner's remaining route, drawn as a band on the ground it crosses so
   * an operator can catch a route that hugs a wall before the robot is against
   * it. A route up a stair is on two storeys; with a floor picked, only that
   * floor's stretch is drawn. An empty `points` means the route is over.
   */
  path?: PlannedPath;
  /**
   * A running dock's target. Drawn as its staging point and the leg onto it,
   * so an operator can see where the route is taking the robot and why it
   * stops short of the dock. Null when no dock runs.
   */
  dock?: PlanarPose | null;
  /**
   * The approach the robot predicts for a dock's last metre, from where it
   * stands to the dock; an empty `points` means the dock goal ended.
   */
  dockPath?: PlannedPath;
  /**
   * Hide the path layer — the route, and a dock's staging leg and approach
   * with it — without unmounting the canvas. Defaults to true.
   */
  showPath?: boolean;
  /**
   * The active map's stored vertices. Draw-only: the "vertex" and "place" picks
   * hand a pose up and the view writes it.
   */
  vertices?: MapVertex[];
  /** Hide the vertex layer without unmounting the canvas. Defaults to true. */
  showVertices?: boolean;
  /** The active map's saved forbidden zones. Draw-only. */
  zones?: ZonePolygon[];
  /** Hide the zone layer without unmounting the canvas. Defaults to true. */
  showZones?: boolean;
  /**
   * Fired when a stored vertex is tapped (press and release inside the drag
   * deadzone, no pick armed). A tap rather than a double-click because phones
   * do not report a double-tap reliably; the dialog this opens is what guards
   * the robot, and the canvas never dispatches anything itself.
   */
  onVertexActivate?: (vertex: MapVertex) => void;
  /**
   * The vertex a `"vertex"` pick is re-placing. Its stored marker is hidden so
   * the stop is not drawn twice, and its heading seeds the draft so a release
   * without a drag keeps it instead of snapping to 0°.
   */
  movingVertex?: MapVertex | null;
  /**
   * "move": left-drag pans. "focus": the target follows the robot and
   * left-drag orbits it. Defaults to "move".
   */
  cameraMode?: "move" | "focus";
  /**
   * Bumped to swing the camera overhead. A nonce (like grid-canvas's
   * `fitNonce`) so the camera stays owned in here; 0 means never pressed. An
   * action, not a mode: the next drag may orbit straight out of it.
   */
  topDownNonce?: number;
  /**
   * Bumped to look at the map level from the south, so storeys read as
   * bands. A nonce for `topDownNonce`'s reason.
   */
  frontNonce?: number;
  /**
   * Bumped to return to the opening view. The view also switches to "move" in
   * the same click, since focus mode would re-pin the target to the robot.
   */
  recenterNonce?: number;
  /**
   * One zoom step: `factor` above 1 closes in. A fresh object per press so
   * identity triggers it and two presses zoom twice. Null between presses.
   */
  zoomStep?: { factor: number } | null;
  /**
   * Stream the "map so far" cloud (only produced while mapping) as a dim layer
   * under the live scan. Each frame replaces the layer wholesale, because a
   * loop closure moves the whole map. Defaults to false.
   */
  mapCloudStream?: boolean;
  /** The map-cloud stream's status; it fails independently of `onStatus`. */
  onMapStatus?: (status: StreamStatus) => void;
  /** Committed goal, drawn on its floor's ground until the caller clears it. */
  goal?: (PlanarPose & { z?: number }) | null;
  /**
   * The initial pose last placed, kept as the reference the reported pose is
   * read against while localization converges, on its floor's ground when it
   * was placed on one. useInitialPose expires it.
   */
  initialPose?: (PlanarPose & { z?: number }) | null;
  /**
   * The ground the initial pose being placed stands on, metres, when it says
   * which floor; the robot is carried at that floor's height mid-drag. Null
   * carries it at the height it is drawn at, as the localizer will keep the
   * storey it is on.
   */
  initialPoseGround?: number | null;
  /**
   * What a press-drag-release on the ground produces, or null: the press is
   * projected onto `pickZ` and the drag gives the heading. Left-button camera
   * motion is suspended while armed. In "initial-pose" the robot model itself
   * follows the pointer until a press plants it. One mode at a time, since the
   * gesture is identical for all of them.
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
  telemetry,
  mapCloud = null,
  voxels = null,
  voxelBand = null,
  pickZ = 0,
  path,
  dock = null,
  dockPath,
  showPath = true,
  vertices,
  showVertices = true,
  zones,
  showZones = true,
  onVertexActivate,
  movingVertex = null,
  cameraMode = "move",
  topDownNonce = 0,
  frontNonce = 0,
  recenterNonce = 0,
  zoomStep = null,
  mapCloudStream = false,
  onMapStatus,
  goal = null,
  initialPose = null,
  initialPoseGround = null,
  pickMode = null,
  onPickCommit,
  onStatus,
  className,
}: PointCloudCanvasProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  // Pose being carried / dragged. State so the marker effect runs per pointer
  // move; that costs a marker transform, not a scene rebuild.
  const [draft, setDraft] = React.useState<PlanarPose | null>(null);

  /**
   * True while the draft follows the bare pointer (no button down), as opposed
   * to planted by a press and turned by a drag.
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
     * The streamed "map so far" layer, rebuilt per frame: frames arrive
     * seconds apart, unlike the preallocated 10 Hz liveGeom.
     */
    streamedMapPoints: THREE.Points | null;
    /**
     * The map extent this scene was built around, or null with no 2D map. Held
     * here so the top-down effect need not depend on `meta`, which would
     * re-frame the camera on every map load.
     */
    mapFrame: MapFrame | null;
    /**
     * The floor plan's plane, or null with no 2D map. Held so the 3D map's
     * layer can thin it while it is shown (see thinGroundUnderVoxels).
     */
    ground: THREE.Mesh | null;
    goalMarker: THREE.Group;
    initialPoseMarker: THREE.Group;
    draftMarker: THREE.Group;
    dispose: () => void;
  } | null>(null);

  /**
   * The 3D map's xy box while its layer is up and there is no floor plan:
   * what Recenter and Top down frame instead of the 20 m fallback. A ref,
   * since those effects are nonce-only on purpose.
   */
  const voxelFrameRef = React.useRef<MapFrame | null>(null);
  /**
   * The 3D map's layer while it is up, so a floor switch can move its band
   * without a rebuild and Front can measure the heights it shows.
   */
  const voxelLayerRef = React.useRef<VoxelLayer | null>(null);
  /** The band as last asked for, which a rebuilt layer starts from. */
  const voxelBandRef = React.useRef(voxelBand);
  /** The 3D map's shading while its layer is up, which every draw goes through. */
  const edlRef = React.useRef<EdlPass | null>(null);
  /** The route's band while it is drawn, so a floor switch can cut it without a rebuild. */
  const pathRibbonRef = React.useRef<PathRibbon | null>(null);

  // Keep the latest onStatus without forcing the setup effect to re-run.
  const onStatusRef = React.useRef(onStatus);
  React.useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  const onMapStatusRef = React.useRef(onMapStatus);
  React.useEffect(() => {
    onMapStatusRef.current = onMapStatus;
  }, [onMapStatus]);

  /**
   * Last streamed map frame, held so the layer survives a scene rebuild: the
   * next one may be seconds away (the live cloud's is 100 ms away).
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
      // Dim and solid like the static map cloud, so the live scan reads on top.
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

  // Through a ref so a theme change re-tints via the setup effect's re-apply
  // instead of bouncing the WebSocket.
  const applyMapStreamFrameRef = React.useRef(applyMapStreamFrame);
  React.useEffect(() => {
    applyMapStreamFrameRef.current = applyMapStreamFrame;
  }, [applyMapStreamFrame]);

  // Read by the render loop and by effects that must not depend on them. The
  // pose refs live at component scope so a scene rebuild does not restart the
  // ease from the world origin.
  const cameraModeRef = React.useRef(cameraMode);
  const pickModeRef = React.useRef(pickMode);
  const targetPoseRef = React.useRef<SmoothPose | null>(null);
  const renderedPoseRef = React.useRef<SmoothPose | null>(null);

  /** Where the robot is drawn instead of the reported pose during an initial-pose pick. */
  const posePreviewRef = React.useRef<SmoothPose | null>(null);

  // `hoverIdRef` drives the highlight at pointer rate; the state beside it
  // exists only so the cursor can change, which needs a render.
  const vertexLayerRef = React.useRef<VertexLayer | null>(null);
  const hoverIdRef = React.useRef<string | null>(null);
  /** Mirrors `movingVertex` for the layer effect, which rebuilds around it. */
  const movingIdRef = React.useRef<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = React.useState<MapVertex | null>(
    null,
  );

  // Each joint resolves to the child-link node it rotates (the GLB keeps URDF
  // link names). The nodes belong to the module-cached model, so the map is
  // resolved once and survives scene rebuilds. `latestJointsRef` buffers angles
  // that arrive before the model has loaded.
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

  /** Record where the robot should be; the render loop eases toward it. */
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

  const telemetryRef = React.useRef(telemetry);
  React.useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);
  /** The last pose object taken off the feed, compared by identity. */
  const feedPoseRef = React.useRef<RobotPose | undefined>(undefined);

  /**
   * Drain the live feed once per drawn frame. A 60 Hz loop reads a 20 Hz feed
   * about three times per message, so both channels are guarded on object
   * identity (the stream hands out a fresh object per message).
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

    // Set by dispose(). The GLB and the ground texture can land after this
    // scene was torn down, and each checks it first.
    let cancelled = false;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme.background);

    // z-up world so ROS map coordinates (x, y, z) map straight through.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    // The 3D map's own layer, so it is drawn by any render that is not its
    // shading pass too.
    camera.layers.enable(EDL_LAYER);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const controls = new OrbitControls(camera, renderer.domElement);
    // OrbitControls writes touch-action: none inline, which stops a swipe
    // scrolling the page below lg. Cleared so the container's class decides
    // (pan-y on a phone, none from lg and while picking).
    renderer.domElement.style.touchAction = "";
    // Shared with Recenter so the two agree on the opening view.
    frameMap(camera, controls, { cx: centerX, cy: centerY, widthM, heightM });
    controls.enableDamping = true;
    // Seeded here so a scene rebuild keeps the camera mode.
    applyCameraMode(
      controls,
      cameraModeRef.current,
      pickModeRef.current !== null,
    );
    controls.update();

    // Ground plane textured with the floor plan, when there is one. At the
    // ground floor's real ground, not 0: the robot's pose and the scans are
    // in the map frame, whose 0 is a body height over that floor.
    let groundTexture: THREE.Texture | null = null;
    const ground = meta
      ? new THREE.Mesh(
          new THREE.PlaneGeometry(widthM, heightM),
          new THREE.MeshBasicMaterial({
            color: theme.ground,
            transparent: true,
            opacity: theme.groundOpacity,
            side: THREE.DoubleSide,
          }),
        )
      : null;
    if (ground) {
      ground.position.set(centerX, centerY, GROUND_FLOOR_Z_M);
      scene.add(ground);

      if (mapImageUrl) {
        new THREE.TextureLoader().load(mapImageUrl, (texture) => {
          // Landed after a rebuild: nothing else would ever free it.
          if (cancelled) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          // Kept so dispose() can free it; disposing a material does not.
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

    // Only the robot is lit. The hemisphere fill keeps its underside off black;
    // the key light rakes across it from the default camera side so the legs
    // read.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    keyLight.position.set(-1, -1.5, 3);
    scene.add(keyLight);

    // Goal, initial pose, and the drag's draft. Placed by the marker effect,
    // which re-runs after a rebuild.
    const goalMarker = createPoseMarker(theme.goal, 1);
    const initialPoseMarker = createPoseMarker(theme.initialPose, 1);
    const draftMarker = createPoseMarker(theme.goalDraft, 0.55);
    scene.add(goalMarker);
    scene.add(initialPoseMarker);
    scene.add(draftMarker);

    // Placed at the reported pose, which is base_link's own height, so the
    // model (base_link at its origin) goes in unlifted: lifting it too would
    // float the robot its own leg length over the floor it stands on.
    const robotGroup = new THREE.Group();
    // Hidden until the first pose arrives.
    robotGroup.visible = false;
    scene.add(robotGroup);

    // `cancelled` matters here: add() reparents, so a stale callback would
    // steal the shared model from the rebuilt scene's group.
    loadRobotModel()
      .then((model) => {
        if (cancelled) return;
        robotGroup.add(model);
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

    // The canvas's client rect, cached: castFromPointer runs per pointermove,
    // and a live read would force a layout each time. In this closure so it
    // dies with this renderer.
    let cachedRect: DOMRect | null = null;
    const invalidateRect = () => {
      cachedRect = null;
    };
    canvasRectRef.current = (fresh) => {
      if (fresh) cachedRect = null;
      return (cachedRect ??= renderer.domElement.getBoundingClientRect());
    };

    const draw = () => {
      const edl = edlRef.current;
      if (edl) edl.render(renderer, scene, camera);
      else renderer.render(scene, camera);
    };

    const resize = () => {
      invalidateRect();
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      edlRef.current?.setSize(rect.width, rect.height, renderer.getPixelRatio());
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      // Draw now: setSize clears the canvas and the observer fires after this
      // frame's render, so without it the cleared canvas is painted.
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    // A scroll moves the canvas without resizing it (the page scrolls below
    // lg). Capture phase, since scroll does not bubble from an ancestor.
    window.addEventListener("scroll", invalidateRect, {
      capture: true,
      passive: true,
    });

    /**
     * Ease the drawn pose toward the reported one. The factor comes from dt so
     * any refresh rate converges at the same wall-clock rate, and a tab
     * restored from the background snaps.
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

          // Focus mode: move the camera by the same delta so the operator's
          // orbit survives while the robot moves.
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

      // Focus follows the reported pose even mid-drag: the machine, not the
      // estimate being placed.
      if (cur && cameraModeRef.current === "focus") {
        controls.target.set(cur.x, cur.y, cur.z);
      }

      // An initial-pose drag draws the robot at the dragged pose, un-eased so
      // it tracks the pointer 1:1.
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

      // Before the ease, so this frame walks toward the newest pose.
      pumpTelemetry();
      stepPose(dt);
      controls.update();
      draw();
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
      // Detach the cached robot model first, or the sweep would dispose it for
      // every later mount.
      robotGroup.clear();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      // By hand: the traverse never reaches a material's texture.
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
      ground,
      goalMarker,
      initialPoseMarker,
      draftMarker,
      dispose,
    };

    // Re-apply the held streamed map frame (and re-tint it for a theme change).
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
  // Opened once per mount and written into whatever geometry sceneRef holds,
  // so a scene rebuild never closes a still-connecting socket.
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
  // Outside the scene effect like the live stream; the applier is read through
  // its ref so a theme change never bounces the socket.
  React.useEffect(() => {
    if (!mapCloudStream) {
      // Drop the held frame too, or the next rebuild's re-apply resurrects it.
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
  // Re-runs on a scene rebuild too, so the mode survives it.
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
  // Nonce-only deps: a map load or theme toggle must not re-frame a view the
  // operator set by hand.
  React.useEffect(() => {
    if (!topDownNonce) return;
    const ctx = sceneRef.current;
    if (!ctx) return;
    const { camera, controls, mapFrame } = ctx;

    // In focus the target is the robot, so keep it and the operator's zoom.
    // Otherwise frame the whole map: going overhead is for seeing the site.
    // With no floor plan the 3D map's box stands in, when its layer is up.
    const framing =
      cameraModeRef.current !== "focus" ? (mapFrame ?? voxelFrameRef.current) : null;
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

  // ---- Front view (one-shot) --------------------------------------------
  // Nonce-only deps, as for top-down. In focus the robot stays the target;
  // otherwise the map's box, at the heights of the floor on show — the whole
  // map's when no floor is picked, a person's height when no 3D map is up.
  React.useEffect(() => {
    if (!frontNonce) return;
    const ctx = sceneRef.current;
    if (!ctx) return;
    if (cameraModeRef.current === "focus") {
      frontViewAround(ctx.camera, ctx.controls);
      return;
    }
    const band = voxelBandRef.current;
    const z =
      voxelLayerRef.current?.zExtent(band?.lo ?? -Infinity, band?.hi ?? Infinity) ??
      FRONT_DEFAULT_Z;
    frontView(
      ctx.camera,
      ctx.controls,
      ctx.mapFrame ??
        voxelFrameRef.current ?? {
          cx: 0,
          cy: 0,
          widthM: DEFAULT_SPAN_M,
          heightM: DEFAULT_SPAN_M,
        },
      z,
    );
  }, [frontNonce]);

  // ---- Recenter (one-shot) ----------------------------------------------
  // Declared after the camera-mode effect on purpose: the same click sets the
  // mode to "move", and effects run in order, so this one gets the last word.
  // Nonce-only deps, as for top-down.
  React.useEffect(() => {
    if (!recenterNonce) return;
    const ctx = sceneRef.current;
    if (!ctx) return;
    frameMap(
      ctx.camera,
      ctx.controls,
      // No floor plan: the 3D map's box if its layer is up, else the setup
      // effect's fallback box around the origin.
      ctx.mapFrame ??
        voxelFrameRef.current ?? {
          cx: 0,
          cy: 0,
          widthM: DEFAULT_SPAN_M,
          heightM: DEFAULT_SPAN_M,
        },
    );
  }, [recenterNonce]);

  // ---- Zoom step (one-shot) ---------------------------------------------
  React.useEffect(() => {
    if (!zoomStep) return;
    const ctx = sceneRef.current;
    if (!ctx) return;
    dollyStep(ctx.camera, ctx.controls, zoomStep.factor);
  }, [zoomStep]);

  // ---- Pick mode: hand the left button over ----------------------------
  // Separate from the camera-mode effect, which re-frames on entering focus;
  // arming a pick must not jolt the view. `cameraMode` is a dep so the button
  // mapping is re-asserted after that effect rewrites it.
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

    // The draft wears the armed mode's hue, so it says which pose is being
    // placed. Disarming mid-drag must not strand it, hence the null.
    setMarkerColor(
      ctx.draftMarker,
      pickMode === "initial-pose" ? theme.initialPoseDraft : theme.goalDraft,
    );
    placePoseMarker(ctx.draftMarker, pickMode && draft ? { ...draft, z: pickZ } : null);
  }, [goal, initialPose, draft, pickMode, pickZ, meta, mapImageUrl, resolvedTheme]);

  // ---- Initial-pose pick: the robot itself is the preview ----------------
  // An initial pose asserts where the machine is, so the machine moves: what
  // stands on the floor at release is what gets published, which is why this
  // flow needs no confirm. A goal pick does not do this — moving the robot to
  // preview somewhere it is not would state something false.
  React.useEffect(() => {
    if (pickMode !== "initial-pose" || !draft) {
      posePreviewRef.current = null;
      return;
    }
    posePreviewRef.current = {
      x: draft.x,
      y: draft.y,
      // Standing on the floor it is placed on, else at the height it is
      // already drawn at; plus the lift while in hand.
      z:
        (initialPoseGround !== null
          ? drawnGround(initialPoseGround) + ROBOT_BASE_HEIGHT_M
          : (renderedPoseRef.current?.z ?? drawnGround(pickZ) + ROBOT_BASE_HEIGHT_M)) +
        (carrying ? CARRY_LIFT_M : 0),
      yaw: (draft.theta * Math.PI) / 180,
    };
  }, [draft, carrying, pickMode, initialPoseGround, pickZ]);

  // ---- Stored map vertices (toggle) ------------------------------------
  // Held in a ref because hover recolours it per pointer move. Lists the
  // scene-rebuild deps so it is re-added to a rebuilt scene; its own cleanup
  // removes it.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showVertices || !vertices?.length) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const layer = createVertexLayer(vertices, theme);
    ctx.scene.add(layer.group);
    vertexLayerRef.current = layer;
    // The hover and moving ids survive a rebuild (a theme toggle, a re-place
    // patching the list mid-gesture).
    layer.setHovered(hoverIdRef.current);
    layer.setMoving(movingIdRef.current);
    layer.setBand(voxelBandRef.current?.lo ?? -Infinity, voxelBandRef.current?.hi ?? Infinity);

    return () => {
      // `ctx.scene` may already be discarded; the dispose is what matters,
      // since the teardown traverse never frees the badge textures.
      ctx.scene.remove(layer.group);
      layer.dispose();
      vertexLayerRef.current = null;
    };
  }, [vertices, showVertices, meta, mapImageUrl, resolvedTheme]);

  // Its own effect so arming a re-place does not rebuild the layer.
  React.useEffect(() => {
    movingIdRef.current = movingVertex?.id ?? null;
    vertexLayerRef.current?.setMoving(movingIdRef.current);
  }, [movingVertex]);

  // ---- Forbidden zones ---------------------------------------------------
  // Built wholesale like the vertex layer, but needs no ref: nothing reaches
  // into it after.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showZones || !zones?.length) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const layer = createZoneLayer(zones, theme);
    ctx.scene.add(layer.group);

    return () => {
      ctx.scene.remove(layer.group);
      layer.dispose();
    };
  }, [zones, showZones, meta, mapImageUrl, resolvedTheme]);

  // ---- Planned path band ------------------------------------------------
  // Each new `path` replaces the last, and the backend's empty-points sample
  // erases it by failing the guard; nothing here decides when a route is over.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showPath || !path || path.points.length < 6) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const ribbon = createPathRibbon(path.points, theme);
    if (!ribbon) return;
    const band = voxelBandRef.current;
    if (band) ribbon.setBand(band.lo, band.hi);
    ctx.scene.add(ribbon.mesh);
    pathRibbonRef.current = ribbon;

    return () => {
      if (pathRibbonRef.current === ribbon) pathRibbonRef.current = null;
      ctx.scene.remove(ribbon.mesh);
      ribbon.dispose();
    };
  }, [path, showPath, meta, mapImageUrl, resolvedTheme]);

  // ---- A dock's approach band ---------------------------------------------
  // The route's rule: each sample replaces the last, the empty one erases it.
  // Dashed, so the last metre onto the dock never reads as more of the route.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showPath || !dockPath || dockPath.points.length < 6) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const ribbon = createDashedRibbon(dockPath.points, theme.dock, { stride: 3 });
    if (!ribbon) return;
    ctx.scene.add(ribbon.mesh);

    return () => {
      ctx.scene.remove(ribbon.mesh);
      ribbon.dispose();
    };
  }, [dockPath, showPath, meta, mapImageUrl, resolvedTheme]);

  // ---- A dock's staging point --------------------------------------------
  // Keyed on the pose's numbers, not its identity: the run is re-read every
  // 2 s and each read is a fresh object for the same dock.
  const dockX = dock?.x;
  const dockY = dock?.y;
  const dockTheta = dock?.theta;
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !showPath || dockX === undefined || dockY === undefined) return;
    if (dockTheta === undefined) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const layer = createDockLayer({ x: dockX, y: dockY, theta: dockTheta }, theme);
    ctx.scene.add(layer.group);

    return () => {
      ctx.scene.remove(layer.group);
      layer.dispose();
    };
  }, [dockX, dockY, dockTheta, showPath, meta, mapImageUrl, resolvedTheme]);

  // ---- Optional static map cloud (toggle) ------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !mapCloud) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const geom = new THREE.BufferGeometry();
    // References the cached frame's array, so a re-add costs no copy.
    geom.setAttribute("position", new THREE.BufferAttribute(mapCloud.positions, 3));
    // Solid colour keeps it distinct from the height-coloured live scan.
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
    ctx.mapPoints = points;
    ctx.scene.add(points);

    return () => {
      // Frees the GPU copy only; the array stays with the query cache.
      ctx.scene.remove(points);
      geom.dispose();
      points.material.dispose();
      if (ctx.mapPoints === points) ctx.mapPoints = null;
    };
  }, [mapCloud, meta, mapImageUrl, resolvedTheme]);

  // ---- Optional 3D map (toggle) -----------------------------------------
  // Same shape as the map scan above, and the same rebuild deps for the same
  // reason. Beyond adding its marks it thins the floor plan while it is up
  // (see thinGroundUnderVoxels), lends its box to Recenter and Top down
  // when there is no floor plan to frame, and is shaded by depth as on the
  // 3D map page (lib/scene/edl.ts); the cleanup undoes all three, so turning
  // the layer off restores the viewport without a rebuild.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !voxels) return;

    const theme = THEMES[resolvedTheme === "dark" ? "dark" : "light"];
    const layer = createVoxelLayer(voxels);
    const band = voxelBandRef.current;
    if (band) layer.setBand(band.lo, band.hi);
    ctx.scene.add(layer.points);
    voxelLayerRef.current = layer;
    const restoreGround = thinGroundUnderVoxels(ctx.ground, theme);
    if (!ctx.mapFrame) voxelFrameRef.current = layer.frame;
    // Only the map is shaded, on its own layer, and the rest is drawn over
    // it. Built here rather than with the scene, so its offscreen target is
    // only held while there is a 3D map to shade.
    layer.points.layers.set(EDL_LAYER);
    const edl = createEdlPass(voxels.res, { layer: EDL_LAYER });
    const size = ctx.renderer.getSize(new THREE.Vector2());
    edl.setSize(size.x, size.y, ctx.renderer.getPixelRatio());
    edlRef.current = edl;

    return () => {
      if (edlRef.current === edl) edlRef.current = null;
      edl.dispose();
      if (voxelLayerRef.current === layer) voxelLayerRef.current = null;
      ctx.scene.remove(layer.points);
      layer.dispose();
      restoreGround();
      if (voxelFrameRef.current === layer.frame) voxelFrameRef.current = null;
    };
  }, [voxels, meta, mapImageUrl, resolvedTheme]);

  // ---- 3D map floor (band) ----------------------------------------------
  // Two numbers on the layer, not a rebuild. Declared after the layer effect
  // so a new layer is built before the band lands on it; the layer effect
  // reads the ref for the same reason, should it rebuild on its own.
  React.useEffect(() => {
    voxelBandRef.current = voxelBand;
    voxelLayerRef.current?.setBand(voxelBand?.lo ?? -Infinity, voxelBand?.hi ?? Infinity);
    // The waypoints and the route follow the floor shown, by their own ground height.
    vertexLayerRef.current?.setBand(voxelBand?.lo ?? -Infinity, voxelBand?.hi ?? Infinity);
    pathRibbonRef.current?.setBand(voxelBand?.lo ?? -Infinity, voxelBand?.hi ?? Infinity);
  }, [voxelBand]);

  // ---- Pose picking -----------------------------------------------------
  // The anchor keeps the raw pointer position beside the ground point so the
  // heading deadzone is in screen pixels; a metric one would vary wildly with
  // perspective depth.
  const anchorRef = React.useRef<{
    pointerId: number;
    wx: number;
    wy: number;
    cx: number;
    cy: number;
  } | null>(null);
  /** A press outside pick mode that may still turn out to be a tap on a stop. */
  const tapRef = React.useRef<{ pointerId: number; cx: number; cy: number } | null>(
    null,
  );
  // Built lazily: a useRef initialiser is evaluated on every render.
  const raycasterRef = React.useRef<THREE.Raycaster | null>(null);
  /** The canvas's cached client rect; installed by the setup effect. */
  const canvasRectRef = React.useRef<
    ((fresh?: boolean) => DOMRect) | null
  >(null);

  /** Aim the shared raycaster through a pointer position, or null off-canvas. */
  const castFromPointer = (event: { clientX: number; clientY: number }) => {
    const ctx = sceneRef.current;
    if (!ctx) return null;
    const rect = canvasRectRef.current?.();
    if (!rect || rect.width === 0 || rect.height === 0) return null;

    const raycaster = (raycasterRef.current ??= new THREE.Raycaster());
    aimRaycaster(raycaster, ctx.camera, rect, event.clientX, event.clientY);
    return raycaster;
  };

  /** Project a pointer position onto the ground of the floor shown. */
  const pickGround = (event: React.PointerEvent) => {
    const raycaster = castFromPointer(event);
    return raycaster ? intersectGround(raycaster, drawnGround(pickZ)) : null;
  };

  /** The stored vertex under a pointer position, or null (also when hidden). */
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
    // Unconditional (setHovered dedupes), which re-lights a marker whose layer
    // was rebuilt under a still pointer.
    vertexLayerRef.current?.setHovered(id);
    if (id === hoverIdRef.current) return;
    hoverIdRef.current = id;
    setHoveredVertex(vertex);
  };

  /**
   * A pose beyond the floor plan can be neither planned to nor localized
   * against, so it is refused. With no floor plan anything goes.
   */
  const insideMap = (wx: number, wy: number) => {
    if (pickZ !== 0 && voxels) return columnAt(voxels, wx, wy) !== null;
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
   * The heading a draft starts at, before any drag aims it. A re-place keeps
   * the stop's own heading, so nudging it does not spin it; the other modes
   * start from the robot's heading at the moment of the press.
   */
  const seedTheta = () =>
    draft?.theta ??
    (pickMode === "vertex"
      ? movingVertex?.theta
      : telemetryRef.current?.pose.current?.theta) ??
    0;

  const handlePointerDown = (event: React.PointerEvent) => {
    // Re-measure on every press. A banner appearing above the viewport moves
    // the canvas without a resize or a scroll, and a stale rect would command
    // a pose offset from the click.
    canvasRectRef.current?.(true);
    if (!pickMode) {
      // Maybe a tap on a vertex, resolved on release so a drag starting on a
      // marker still orbits. Primary pointer only: a second finger is a pinch.
      tapRef.current =
        event.button === 0 && event.isPrimary && onVertexActivate
          ? { pointerId: event.pointerId, cx: event.clientX, cy: event.clientY }
          : null;
      return;
    }
    if (event.button !== 0) return;
    // A second finger is a pinch or orbit, never a second placement, and the
    // first finger's lift must not then commit what it was aiming.
    if (anchorRef.current || !event.isPrimary) {
      abandonPick();
      return;
    }
    const hit = pickGround(event);
    if (!hit || !insideMap(hit.wx, hit.wy)) return;
    anchorRef.current = {
      ...hit,
      pointerId: event.pointerId,
      cx: event.clientX,
      cy: event.clientY,
    };
    // On the canvas, not this container: capturing higher would steal the
    // pointer from OrbitControls and strand its pointerup.
    sceneRef.current?.renderer.domElement.setPointerCapture(event.pointerId);
    setCarrying(false);
    // Keep the carried heading so a plain click does not snap to 0deg.
    setDraft({ x: hit.wx, y: hit.wy, theta: seedTheta() });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!pickMode) {
      // Hover-test only with no button down; a button down is a camera drag.
      if (event.buttons === 0) hoverVertex(pickVertex(event));
      return;
    }
    // While placing a pose nothing on the map is a target.
    hoverVertex(null);
    if (!event.isPrimary) return;

    const anchor = anchorRef.current;

    // No press yet: carry the pose under the pointer. Not in goal mode, where a
    // trailing arrow would read as a goal already set; the other modes move
    // something that exists. Off the map nothing is carried.
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

    // Planted: the drag only aims, past the shared deadzone.
    let theta = seedTheta();
    if (isDrag(anchor.cx, anchor.cy, event.clientX, event.clientY)) {
      // World-space, not the screen delta: the camera may face any azimuth.
      const hit = pickGround(event);
      if (hit) theta = headingDegrees(hit.wx - anchor.wx, hit.wy - anchor.wy) ?? theta;
    }
    setDraft({ x: anchor.wx, y: anchor.wy, theta });
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const tap = tapRef.current;
    if (tap) {
      tapRef.current = null;
      // Ignored if a pick was armed between press and release.
      if (
        !pickMode &&
        tap.pointerId === event.pointerId &&
        !isDrag(tap.cx, tap.cy, event.clientX, event.clientY)
      ) {
        const vertex = pickVertex(event);
        if (vertex) onVertexActivate?.(vertex);
      }
    }
    const anchor = anchorRef.current;
    if (!anchor || anchor.pointerId !== event.pointerId) return;
    anchorRef.current = null;
    const canvas = sceneRef.current?.renderer.domElement;
    if (canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (draft && pickMode) onPickCommit?.(draft);
    setDraft(null);
    setCarrying(false);
  };

  /**
   * Drop a planted press without committing. A second finger or a
   * pointercancel is not a deliberate release; only handlePointerUp commits.
   */
  const abandonPick = () => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const canvas = sceneRef.current?.renderer.domElement;
    if (anchor && canvas?.hasPointerCapture(anchor.pointerId)) {
      canvas.releasePointerCapture(anchor.pointerId);
    }
    setDraft(null);
    setCarrying(false);
  };

  const handlePointerCancel = (event: React.PointerEvent) => {
    if (tapRef.current?.pointerId === event.pointerId) tapRef.current = null;
    if (anchorRef.current?.pointerId === event.pointerId) abandonPick();
  };

  // Leaving the viewport drops the carried draft (a captured drag survives).
  // This is also what clears it on disarm: the disarm button is off-canvas.
  const handlePointerLeave = () => {
    hoverVertex(null);
    tapRef.current = null;
    if (anchorRef.current) return;
    setDraft(null);
    setCarrying(false);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full touch-pan-y overflow-hidden lg:touch-none",
        pickMode && "cursor-crosshair touch-none",
        // The only sign that a marker is clickable.
        !pickMode && hoveredVertex && "cursor-pointer",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
    />
  );
}
