// The active map's forbidden zones, as marks on the floor.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";
import type { ZonePolygon } from "@/lib/types/map";

/*
 * Below the route (PATH_Z_M, 0.012) and so below every stop and marker: a
 * zone is ground the others sit on, and a route or a stop inside one is
 * exactly the thing the operator must still be able to see. Above the ground
 * plane at 0, by enough not to z-fight with it at a grazing angle.
 */
const ZONE_Z_M = 0.006;
/*
 * The edge, as a band of real width for path-ribbon.ts's reason: WebGL has no
 * line width, and a 1 px hairline vanishes across a warehouse. 6 cm is half
 * the route's band, so where a route runs along a zone's edge both read.
 */
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
 * The edge of one zone: one quad per side, centred on it. Not joined at the
 * corners like the route is, because the edge is drawn opaque — the overlap
 * a corner leaves is invisible, where on the translucent route it would
 * blend into a darker spot at every turn. A missing sliver at a sharp corner
 * is the price, and at 6 cm it does not read.
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
    // Two corners on one spot: no side to draw, and a zero-length normal
    // would put NaN in the buffer and blank the whole mesh.
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
 * Every zone as a translucent wash with a solid edge, in the one hue that
 * says "not here" — the floor plan editor's `warn`, so a zone drawn there is
 * recognisably the same mark here. Built wholesale and thrown away on any
 * change, like the vertex layer: a map has a handful of zones, and they
 * change only when someone saves.
 *
 * Draws only. Nothing in it is pickable: a zone is not something a tap on
 * the dashboard does anything with, and a goal aimed inside one is the
 * planner's to refuse, not this layer's to swallow.
 *
 * A zone with fewer than three corners is skipped rather than thrown on —
 * the backend refuses one on save, so it can only be a file edited by hand.
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
      // Ground marking, like the stops': writing depth would let the wash
      // hide the scan and the route drawn through it.
      depthWrite: false,
    });
  const wash = material(0.22);
  const edge = material(0.9);

  for (const zone of zones) {
    if (zone.points.length < 3) continue;
    const fill = zoneFill(zone);
    geometries.push(fill);
    const washMesh = new THREE.Mesh(fill, wash);
    // After the ground plane, which is translucent too and so sorted with
    // it by distance: left to that sort, the ground drew over the wash from
    // most angles and all but erased it.
    washMesh.renderOrder = 1;
    group.add(washMesh);
    const outline = zoneEdge(zone);
    if (outline) {
      geometries.push(outline);
      const mesh = new THREE.Mesh(outline, edge);
      // Over its own wash, which shares the plane: without an order the two
      // coplanar translucent meshes trade places as the camera moves.
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
