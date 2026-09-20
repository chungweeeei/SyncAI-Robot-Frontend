// The stored-vertex layer: every saved stop, drawn as ground marking.

import * as THREE from "three";

import { vertexGlyph } from "@/lib/map/vertex";
import type { Theme } from "@/lib/scene/theme";
import { cssHex } from "@/lib/theme/signal";
import type { MapVertex } from "@/lib/types/map";

/*
 * Vertex markers, in metres.
 *
 * Deliberately *not* the ring-and-arrow of createPoseMarker at a smaller scale.
 * A map carries a dozen or more stored stops and only ever one goal, and a dozen
 * arrows crossing each other at floor level is noise the operator has to read
 * past to find the marker they are acting on. A stop is instead a flat target on
 * the floor — a translucent disc, a crisp ring, and a chevron for the heading —
 * so the whole layer reads as ground marking rather than as instruments.
 *
 * The chevron is what carries the heading, and it is short: a stop's heading is
 * worth knowing but never worth as much screen as the goal's, which is drawn as
 * a full arrow because it is the pose being commanded right now.
 *
 * The mark sits lower than MARKER_Z_M so a goal placed on a stop draws over it
 * rather than z-fighting with it.
 */
const VERTEX_DISC_RADIUS_M = 0.2;
// A 5 cm band rather than 3: the ring is what locates the stop from across a
// warehouse, and a hairline ring is the first thing to alias away at distance.
const VERTEX_RING_INNER_M = 0.2;
const VERTEX_RING_OUTER_M = 0.25;
const VERTEX_CHEVRON_BASE_M = 0.31;
const VERTEX_CHEVRON_TIP_M = 0.46;
const VERTEX_CHEVRON_HALF_M = 0.1;
const VERTEX_Z_M = 0.02;

/*
 * The floor mark alone disappears the moment the camera drops toward the
 * horizon — which is most of the time, because the useful views of a robot are
 * from behind and low. A thin stem and a small badge above it give every stop a
 * vertical presence that survives a grazing camera, the same way a pin does on a
 * street map, without adding anything at floor level.
 *
 * The badge carries the type glyph and nothing else. The name lives in the
 * dialog a double-click opens: a caption per stop is the one thing that turns
 * this layer back into clutter, and the operator only needs a name at the moment
 * they are about to act on one.
 */
const VERTEX_STEM_HEIGHT_M = 0.6;
const VERTEX_STEM_RADIUS_M = 0.009;
const VERTEX_BADGE_SIZE_M = 0.22;
/** Badge scale-up on hover — the marker under the pointer has to answer back. */
const VERTEX_BADGE_HOVER_SCALE = 1.3;
/** Texture resolution of a badge, not its drawn size. */
const VERTEX_BADGE_TEXTURE_PX = 128;
/**
 * Radius of the invisible disc that catches the pointer. Comfortably wider than
 * the mark itself, for the same reason the gridmap editor's VERTEX_HIT_RADIUS is
 * wider than its dot: a stop is a point, and a point is hard to hit.
 */
const VERTEX_HIT_RADIUS_M = 0.42;

/** Materials for one vertex hue, shared by every marker drawn in it. */
interface VertexMaterials {
  /** The disc: present, but never competing with the cloud drawn over it. */
  fill: THREE.MeshBasicMaterial;
  /** Ring and chevron — the part that has to stay crisp at distance. */
  line: THREE.MeshBasicMaterial;
  stem: THREE.MeshBasicMaterial;
}

function createVertexMaterials(color: number): VertexMaterials {
  const make = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      // Ground marking, not geometry: writing depth would let one stop's
      // translucent disc erase the cloud behind the next one.
      depthWrite: false,
    });
  // The ring and chevron are drawn flat out: they are the mark. Only the disc
  // stays translucent, and even that is now solid enough to read as a target
  // through the live cloud rather than as a smudge under it.
  return { fill: make(0.35), line: make(1), stem: make(0.7) };
}

/**
 * The type badge: a filled disc in the marker hue with the glyph knocked out in
 * near-white, plus a pale rim.
 *
 * The hue is baked in rather than left to `SpriteMaterial.color` tinting a white
 * texture. Tinting was cheaper — one texture served both the resting and hover
 * hues — but it forces the glyph to be a *darkened* version of the disc it sits
 * on, and once the disc hue went dark enough to be findable, dark-on-dark is
 * what that leaves. A light glyph on a solid dark disc is the contrast that
 * makes the badge readable at a glance, and it is the same figure/ground the
 * console's own chips use.
 *
 * Two textures per glyph then, resting and hover — ten in the worst case, all
 * 128 px, all built once per layer.
 */
function createBadgeTexture(glyph: string, fill: number): THREE.CanvasTexture {
  const size = VERTEX_BADGE_TEXTURE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const centre = size / 2;
  ctx.fillStyle = cssHex(fill);
  ctx.beginPath();
  ctx.arc(centre, centre, centre - size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // A pale rim, so a dark badge keeps its edge against the near-black
  // background of a map with no gridmap under it.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = size * 0.05;
  ctx.stroke();

  ctx.fillStyle = "#f2f7fa";
  ctx.font = `700 ${size * 0.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // +2% down: the monospace cap sits high in the em box, and a badge whose
  // letter is off-centre is the kind of thing you see without being able to
  // name it.
  ctx.fillText(glyph, centre, centre + size * 0.02);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Everything one vertex owns, so hover can recolour it without a rebuild. */
interface VertexHandle {
  fill: THREE.Mesh[];
  line: THREE.Mesh[];
  stem: THREE.Mesh[];
  badge: THREE.Sprite;
  /** Resting and hover faces of this stop's badge, swapped by `paint`. */
  badgeTextures: { base: THREE.CanvasTexture; hover: THREE.CanvasTexture };
  /** The mark itself, hidden as a whole while the stop is being re-placed. */
  marker: THREE.Group;
}

export interface VertexLayer {
  group: THREE.Group;
  /** What a pointer ray is tested against. */
  pickables: THREE.Object3D[];
  /** Resolve a `userData.vertexId` from a hit back to its row. */
  byId: Map<string, MapVertex>;
  /** Light up one marker, or none. Cheap enough to call per pointer move. */
  setHovered: (id: string | null) => void;
  /** Take one marker off the map while its pose is in the operator's hands. */
  setMoving: (id: string | null) => void;
  dispose: () => void;
}

/**
 * The whole stored-vertex layer as one group, plus the disposer for everything
 * it allocated.
 *
 * Built wholesale and thrown away on any change rather than diffed: the list
 * comes from a fetch-once-per-mount hook, so "any change" means a map swap or a
 * theme toggle, not a stream. Geometry, materials and the badge textures are all
 * shared across the layer; a vertex owns only its meshes, its sprite material
 * (which carries the tint hover changes) and its transforms.
 */
export function createVertexLayer(
  vertices: MapVertex[],
  theme: Theme,
): VertexLayer {
  const group = new THREE.Group();
  const base = createVertexMaterials(theme.vertex);
  const hover = createVertexMaterials(theme.vertexHover);

  const discGeom = new THREE.CircleGeometry(VERTEX_DISC_RADIUS_M, 32);
  const ringGeom = new THREE.RingGeometry(
    VERTEX_RING_INNER_M,
    VERTEX_RING_OUTER_M,
    32,
  );
  // Both the chevron and the ring are already in the XY plane, i.e. flat on
  // this z-up world, and the chevron already points down +x — so the marker
  // group's rotation.z is the heading, exactly as in createPoseMarker.
  const chevron = new THREE.Shape();
  chevron.moveTo(VERTEX_CHEVRON_TIP_M, 0);
  chevron.lineTo(VERTEX_CHEVRON_BASE_M, VERTEX_CHEVRON_HALF_M);
  chevron.lineTo(VERTEX_CHEVRON_BASE_M, -VERTEX_CHEVRON_HALF_M);
  chevron.closePath();
  const chevronGeom = new THREE.ShapeGeometry(chevron);
  const stemGeom = new THREE.CylinderGeometry(
    VERTEX_STEM_RADIUS_M,
    VERTEX_STEM_RADIUS_M,
    VERTEX_STEM_HEIGHT_M,
    6,
  );
  const hitGeom = new THREE.CircleGeometry(VERTEX_HIT_RADIUS_M, 12);
  // The hit discs are `visible = false` (set per mesh below) and still picked:
  // three's Raycaster tests layers, never visibility, so a flagged-off mesh
  // costs no draw call and keeps catching rays. That is the whole job here.
  const hitMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Keyed by glyph *and* face, so five types cost at most ten textures however
  // many stops the map has.
  const badgeTextures = new Map<string, THREE.CanvasTexture>();
  const badgeTexture = (glyph: string, hovered: boolean) => {
    const key = `${hovered ? "h" : "b"}:${glyph}`;
    let texture = badgeTextures.get(key);
    if (!texture) {
      texture = createBadgeTexture(
        glyph,
        hovered ? theme.vertexHover : theme.vertex,
      );
      badgeTextures.set(key, texture);
    }
    return texture;
  };
  const handles = new Map<string, VertexHandle>();
  const pickables: THREE.Object3D[] = [];
  const byId = new Map<string, MapVertex>();

  for (const vertex of vertices) {
    byId.set(vertex.id, vertex);

    const marker = new THREE.Group();
    marker.position.set(vertex.x, vertex.y, VERTEX_Z_M);
    marker.rotation.z = (vertex.theta * Math.PI) / 180;

    const disc = new THREE.Mesh(discGeom, base.fill);
    const ring = new THREE.Mesh(ringGeom, base.line);
    const head = new THREE.Mesh(chevronGeom, base.line);

    const stem = new THREE.Mesh(stemGeom, base.stem);
    // The cylinder runs along +y by default; +90deg about x stands it up.
    stem.rotation.x = Math.PI / 2;
    stem.position.z = VERTEX_STEM_HEIGHT_M / 2;

    const hit = new THREE.Mesh(hitGeom, hitMaterial);
    hit.userData.vertexId = vertex.id;
    hit.visible = false;

    marker.add(disc, ring, head, stem, hit);
    group.add(marker);

    const glyph = vertexGlyph(vertex.type);
    const faces = {
      base: badgeTexture(glyph, false),
      hover: badgeTexture(glyph, true),
    };
    const badge = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: faces.base,
        transparent: true,
        depthWrite: false,
      }),
    );
    badge.scale.setScalar(VERTEX_BADGE_SIZE_M);
    // Hung off the layer rather than the marker: a sprite ignores rotation, so
    // parenting it under the heading transform would only hide that fact.
    // Lifted by a third of its own height so it caps the stem instead of
    // swallowing the top of it.
    badge.position.set(
      vertex.x,
      vertex.y,
      VERTEX_Z_M + VERTEX_STEM_HEIGHT_M + VERTEX_BADGE_SIZE_M / 3,
    );
    badge.userData.vertexId = vertex.id;
    group.add(badge);

    pickables.push(hit, badge);
    handles.set(vertex.id, {
      fill: [disc],
      line: [ring, head],
      stem: [stem],
      badge,
      badgeTextures: faces,
      marker,
    });
  }

  let hovered: string | null = null;

  const paint = (id: string | null, on: boolean) => {
    const handle = id ? handles.get(id) : undefined;
    if (!handle) return;
    const set = on ? hover : base;
    for (const mesh of handle.fill) mesh.material = set.fill;
    for (const mesh of handle.line) mesh.material = set.line;
    for (const mesh of handle.stem) mesh.material = set.stem;
    const material = handle.badge.material as THREE.SpriteMaterial;
    material.map = on ? handle.badgeTextures.hover : handle.badgeTextures.base;
    // Swapping the map is a program change, not a uniform change.
    material.needsUpdate = true;
    handle.badge.scale.setScalar(
      on ? VERTEX_BADGE_SIZE_M * VERTEX_BADGE_HOVER_SCALE : VERTEX_BADGE_SIZE_M,
    );
  };

  const setHovered = (id: string | null) => {
    // An id this layer does not know is treated as none: the caller's idea of
    // what is hovered outlives a rebuild, and a map swap can retire the stop it
    // names. Resolving it here (rather than trusting the id) is what keeps a
    // rebuilt layer from carrying a highlight nothing can clear.
    const next = id && handles.has(id) ? id : null;
    if (next === hovered) return;
    paint(hovered, false);
    paint(next, true);
    hovered = next;
  };

  let moving: string | null = null;

  const setMoving = (id: string | null) => {
    const next = id && handles.has(id) ? id : null;
    if (next === moving) return;
    for (const candidate of [moving, next]) {
      const handle = candidate ? handles.get(candidate) : undefined;
      if (!handle) continue;
      // Group visibility covers the whole mark; the badge is hung off the layer
      // rather than the marker, so it has to be told separately.
      const shown = candidate !== next;
      handle.marker.visible = shown;
      handle.badge.visible = shown;
    }
    moving = next;
  };

  const dispose = () => {
    for (const geometry of [
      discGeom,
      ringGeom,
      chevronGeom,
      stemGeom,
      hitGeom,
    ]) {
      geometry.dispose();
    }
    for (const set of [base, hover]) {
      set.fill.dispose();
      set.line.dispose();
      set.stem.dispose();
    }
    hitMaterial.dispose();
    // Textures are shared between the badges wearing the same glyph, so they are
    // freed here rather than per badge — and they have to be freed here at all:
    // the scene teardown's traverse reaches geometries and materials, never the
    // texture a material points at.
    for (const texture of badgeTextures.values()) texture.dispose();
    for (const handle of handles.values()) handle.badge.material.dispose();
  };

  return { group, pickables, byId, setHovered, setMoving, dispose };
}
