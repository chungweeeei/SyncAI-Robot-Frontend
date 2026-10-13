// The active map's forbidden zones, as marks on the floor.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";
import type { ZonePolygon } from "@/lib/types/map";

/*
 * Below the route and every marker, so a route or stop inside a zone stays
 * visible; above the ground plane by enough not to z-fight at a grazing angle.
 */
const ZONE_Z_M = 0.006;
/* The edge as a band, for path-ribbon.ts's reason; half the route's width so both read side by side. */
const ZONE_EDGE_M = 0.06;

/**
 * The fill of one zone, triangulated in the map frame. Earcut (inside
 * ShapeGeometry) tolerates the concave and notched shapes the editor's merge
 * makes; a self-crossing outline fills imperfectly but still fills.
 */
function zoneFill(zone: ZonePolygon): THREE.ShapeGeometry {
  const shape = new THREE.Shape(zone.points.map(({ x, y }) => new THREE.Vector2(x, y)));
  return new THREE.ShapeGeometry(shape);
}

/**
 * The edge of one zone: one quad per side. Unjoined, unlike the route,
 * because the edge is opaque and corner overlaps do not show.
 */
function zoneEdge(zone: ZonePolygon): THREE.BufferGeometry | null {
  const n = zone.points.length;
  const half = ZONE_EDGE_M / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = zone.points[i];
    const b = zone.points[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // A zero-length side would put NaN in the buffer and blank the whole mesh.
    if (len < 1e-6) continue;
    const ox = (-(b.y - a.y) / len) * half;
    const oy = ((b.x - a.x) / len) * half;
    const v = positions.length / 3;
    positions.push(
      a.x + ox, a.y + oy, 0,
      a.x - ox, a.y - oy, 0,
      b.x + ox, b.y + oy, 0,
      b.x - ox, b.y - oy, 0,
    );
    indices.push(v, v + 1, v + 3, v, v + 3, v + 2);
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Every zone as a translucent wash with a solid edge in `warn`, rebuilt on any
 * change. Not pickable: a goal inside a zone is the planner's to refuse. A
 * zone under three corners (only possible by hand-editing) is skipped.
 */
export function createZoneLayer(
  zones: readonly ZonePolygon[],
  theme: Theme,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.position.z = ZONE_Z_M;
  const geometries: THREE.BufferGeometry[] = [];

  const material = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      color: theme.zone,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      // Writing depth would let the wash hide the scan and route through it.
      depthWrite: false,
    });
  const wash = material(0.22);
  const edge = material(0.9);

  for (const zone of zones) {
    if (zone.points.length < 3) continue;
    const fill = zoneFill(zone);
    geometries.push(fill);
    const washMesh = new THREE.Mesh(fill, wash);
    // After the translucent ground plane, which otherwise sorts over the wash.
    washMesh.renderOrder = 1;
    group.add(washMesh);
    const outline = zoneEdge(zone);
    if (outline) {
      geometries.push(outline);
      const mesh = new THREE.Mesh(outline, edge);
      // Over its coplanar wash, or the two trade places as the camera moves.
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  }

  return {
    group,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      wash.dispose();
      edge.dispose();
    },
  };
}
