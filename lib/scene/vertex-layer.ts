// The stored-vertex layer: every saved stop, drawn as ground marking.

import * as THREE from "three";

import { drawnGround } from "@/lib/map/floors";
import { vertexGlyph } from "@/lib/map/vertex";
import type { Theme } from "@/lib/scene/theme";
import { cssHex } from "@/lib/theme/signal";
import type { MapVertex } from "@/lib/types/map";

/*
 * Vertex markers, in metres. Not createPoseMarker's ring-and-arrow: a dozen
 * crossing arrows would bury the one goal, so a stop is flat ground marking
 * (disc, ring, short heading chevron). It sits below MARKER_Z_M so a goal on a
 * stop draws over it instead of z-fighting.
 */
const VERTEX_DISC_RADIUS_M = 0.2;
// A 5 cm band: a hairline ring aliases away at distance.
const VERTEX_RING_INNER_M = 0.2;
const VERTEX_RING_OUTER_M = 0.25;
/** The halo's band, a little wider than the ring on both sides so it shows as a rim. */
const VERTEX_HALO_INNER_M = 0.17;
const VERTEX_HALO_OUTER_M = 0.29;
const VERTEX_HALO_OPACITY = 0.85;
const VERTEX_CHEVRON_BASE_M = 0.31;
const VERTEX_CHEVRON_TIP_M = 0.46;
const VERTEX_CHEVRON_HALF_M = 0.1;
const VERTEX_Z_M = 0.02;

/*
 * A stem and badge, like a map pin, because a floor mark vanishes at the low
 * camera angles that are most useful. The badge carries only the type glyph;
 * per-stop names would be clutter, so the name is in the dialog a tap opens.
 *
 * The pin is drawn over everything else (no depth test, a late render order):
 * over a 3D map a wall between the camera and a stop buried it whole, while
 * its badge was still pickable through the wall. The ground mark keeps its
 * depth test, so where the stop stands still reads in 3D.
 */
const VERTEX_STEM_HEIGHT_M = 0.6;
const VERTEX_STEM_RADIUS_M = 0.012;
const VERTEX_BADGE_SIZE_M = 0.3;
/** After the scene's own objects, so the pin lands on top of them. */
const VERTEX_PIN_RENDER_ORDER = 10;
/** Badge scale-up on hover — the marker under the pointer has to answer back. */
const VERTEX_BADGE_HOVER_SCALE = 1.3;
/** Texture resolution of a badge, not its drawn size. */
const VERTEX_BADGE_TEXTURE_PX = 128;
/** Radius of the invisible disc that catches the pointer; wider than the mark, since a point is hard to hit. */
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
  const make = (opacity: number, depthTest = true) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      // Ground marking, not geometry: writing depth would let one stop's
      // translucent disc erase the cloud behind the next one.
      depthWrite: false,
      depthTest,
    });
  // Ring and chevron opaque; the disc solid enough to read as a spot over
  // the 3D map's coloured cells, not a tint of them.
  return { fill: make(0.5), line: make(1), stem: make(0.9, false) };
}

/**
 * The type badge: a disc in the marker hue, a near-white glyph, a pale rim.
 *
 * The hue is baked in rather than tinted via `SpriteMaterial.color`, because
 * tinting can only darken the glyph, leaving dark-on-dark. Hence two textures
 * per glyph (resting, hover), ten at most, built once per layer.
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
  // A pale rim keeps a dark badge's edge against a near-black background.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = size * 0.05;
  ctx.stroke();

  ctx.fillStyle = "#f2f7fa";
  ctx.font = `700 ${size * 0.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // +2% down: the monospace cap sits high in the em box.
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
  /** Light up a set of markers in the hover hue: the editor's selection. Unknown ids are skipped. */
  setSelected: (ids: readonly string[]) => void;
  /** Take one marker off the map while its pose is in the operator's hands. */
  setMoving: (id: string | null) => void;
  /** Show only the stops whose ground height is in [lo, hi); ±Infinity is every floor. */
  setBand: (lo: number, hi: number) => void;
  dispose: () => void;
}

/**
 * The whole stored-vertex layer as one group, plus its disposer.
 *
 * Rebuilt on any change rather than diffed: a change is a map swap or theme
 * toggle, not a stream. Geometry, materials and badge textures are shared; a
 * vertex owns only its meshes, its sprite material and its transforms.
 */
export function createVertexLayer(
  vertices: MapVertex[],
  theme: Theme,
): VertexLayer {
  const group = new THREE.Group();
  const base = createVertexMaterials(theme.vertex);
  const hover = createVertexMaterials(theme.vertexHover);
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: theme.vertexHalo,
    transparent: true,
    opacity: VERTEX_HALO_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const discGeom = new THREE.CircleGeometry(VERTEX_DISC_RADIUS_M, 32);
  const ringGeom = new THREE.RingGeometry(
    VERTEX_RING_INNER_M,
    VERTEX_RING_OUTER_M,
    32,
  );
  const haloGeom = new THREE.RingGeometry(VERTEX_HALO_INNER_M, VERTEX_HALO_OUTER_M, 32);
  // Ring and chevron lie in the XY plane (flat in this z-up world) and the
  // chevron points down +x, so the group's rotation.z is the heading.
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
  // The hit discs are `visible = false` yet still picked: Raycaster tests
  // layers, never visibility, so they cost no draw call.
  const hitMaterial = new THREE.MeshBasicMaterial({
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // Keyed by glyph and face: at most ten textures however many stops.
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
    const ground = drawnGround(vertex.z);

    const marker = new THREE.Group();
    // On the ground of its own floor, so an upstairs stop stands on that floor.
    marker.position.set(vertex.x, vertex.y, ground + VERTEX_Z_M);
    marker.rotation.z = (vertex.theta * Math.PI) / 180;

    const disc = new THREE.Mesh(discGeom, base.fill);
    // Under the ring, in draw order as well as in place: a hair below it,
    // and drawn first, so the ring lands on the rim rather than mixing with it.
    const halo = new THREE.Mesh(haloGeom, haloMaterial);
    halo.position.z = -0.001;
    halo.renderOrder = -1;
    const ring = new THREE.Mesh(ringGeom, base.line);
    const head = new THREE.Mesh(chevronGeom, base.line);

    const stem = new THREE.Mesh(stemGeom, base.stem);
    // The cylinder runs along +y by default; +90deg about x stands it up.
    stem.rotation.x = Math.PI / 2;
    stem.position.z = VERTEX_STEM_HEIGHT_M / 2;
    stem.renderOrder = VERTEX_PIN_RENDER_ORDER;

    const hit = new THREE.Mesh(hitGeom, hitMaterial);
    hit.userData.vertexId = vertex.id;
    hit.visible = false;

    marker.add(halo, disc, ring, head, stem, hit);
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
        depthTest: false,
      }),
    );
    badge.renderOrder = VERTEX_PIN_RENDER_ORDER + 1;
    badge.scale.setScalar(VERTEX_BADGE_SIZE_M);
    // Hung off the layer, not the marker: a sprite ignores rotation anyway.
    // Lifted a third of its height so it caps the stem.
    badge.position.set(
      vertex.x,
      vertex.y,
      ground + VERTEX_Z_M + VERTEX_STEM_HEIGHT_M + VERTEX_BADGE_SIZE_M / 3,
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
  let selected = new Set<string>();

  /** Lit while hovered or selected, so un-hovering a selected stop leaves it lit. */
  const paint = (id: string | null) => {
    const handle = id ? handles.get(id) : undefined;
    if (!handle || !id) return;
    const on = id === hovered || selected.has(id);
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
    // An unknown id is none: the caller's hover outlives a rebuild, and trusting
    // a retired id would leave a highlight nothing can clear.
    const next = id && handles.has(id) ? id : null;
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    paint(previous);
    paint(next);
  };

  const setSelected = (ids: readonly string[]) => {
    const previous = selected;
    selected = new Set(ids.filter((id) => handles.has(id)));
    for (const id of new Set([...previous, ...selected])) paint(id);
  };

  let moving: string | null = null;
  // The floor shown, by ground height: [lo, hi), the 3D map's band rule.
  let bandLo = -Infinity;
  let bandHi = Infinity;
  const onFloor = (vertex: MapVertex) => {
    const ground = drawnGround(vertex.z);
    return ground >= bandLo && ground < bandHi;
  };
  const allPickables = [...pickables];

  const show = (id: string) => {
    const handle = handles.get(id)!;
    // The badge hangs off the layer, not the marker, so hide it separately.
    const shown = id !== moving && onFloor(byId.get(id)!);
    handle.marker.visible = shown;
    handle.badge.visible = shown;
  };

  const setMoving = (id: string | null) => {
    const next = id && handles.has(id) ? id : null;
    if (next === moving) return;
    const previous = moving;
    moving = next;
    for (const candidate of [previous, next]) if (candidate) show(candidate);
  };

  /**
   * Show only the stops on one floor. Another floor's stop is hidden *and*
   * unpickable: a raycast ignores `visible`, and a tap through the floor
   * shown must not open a stop under it.
   */
  const setBand = (lo: number, hi: number) => {
    if (lo === bandLo && hi === bandHi) return;
    bandLo = lo;
    bandHi = hi;
    for (const id of handles.keys()) show(id);
    pickables.length = 0;
    for (const object of allPickables) {
      if (onFloor(byId.get(object.userData.vertexId as string)!)) pickables.push(object);
    }
  };

  const dispose = () => {
    for (const geometry of [
      discGeom,
      ringGeom,
      haloGeom,
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
    haloMaterial.dispose();
    // Freed by hand: the scene teardown never reaches a material's texture.
    for (const texture of badgeTextures.values()) texture.dispose();
    for (const handle of handles.values()) handle.badge.material.dispose();
  };

  return { group, pickables, byId, setHovered, setSelected, setMoving, setBand, dispose };
}
