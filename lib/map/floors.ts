// The floors of a map that spans storeys: the height band each one owns, and
// the rules a list has to keep for the backend to save it.

import type { MapFloor } from "@/lib/types/map";

/** Mirrors FLOORS_MAX, FLOOR_NAME_MAX and FLOOR_MIN_SEPARATION_M in the backend's map router. */
export const FLOORS_MAX = 16;
export const FLOOR_NAME_MAX = 16;
export const FLOOR_MIN_SEPARATION_M = 1.0;

/**
 * How far under a floor's level its band starts, metres. A level is the
 * body's height, and the ground sits about half a metre under it; a metre
 * keeps the ground and the slab's top in the floor it belongs to, so the
 * floor below ends just under them and keeps its own ceiling.
 */
export const FLOOR_BAND_BELOW_M = 1.0;

/**
 * How far over a floor's level its band ends, metres: about two metres over
 * the ground, a plan's cut. Walls and doorways are in it and the ceiling is
 * not — a floor seen from above was otherwise its own ceiling, with the
 * ground it is picked to place waypoints on hidden under it.
 */
export const FLOOR_BAND_ABOVE_M = 1.5;

/**
 * How far a floor's ground sits under its level, metres: the body height
 * the robot's planner subtracts from its own pose (`lidar_height`) to find
 * the ground it starts on. Where a waypoint is put when the 3D map cannot
 * say where that floor's ground is.
 */
export const FLOOR_GROUND_BELOW_LEVEL_M = 0.48;

/** A height a new floor is offered at above the top one: a storey, give or take. */
export const NEW_FLOOR_STEP_M = 3.0;

export interface FloorBand extends MapFloor {
  /** Lowest z drawn for this floor, metres; -Infinity for the lowest floor. */
  lo: number;
  /** Highest z, exclusive: a cut over the level, or where the next floor starts. */
  hi: number;
}

/**
 * The bands the floors cut the map into, lowest first: from a metre under a
 * floor's level (the lowest takes everything under it — a pit, a stray
 * return under the slab) to its cut, `FLOOR_BAND_ABOVE_M` over the level, or
 * the next floor's start if that comes first. What is over the cut — the
 * ceiling, the void over it — is on no floor, and only All shows it. A map
 * of one storey is one band of everything: there is nothing to pick.
 */
export function floorBands(floors: readonly MapFloor[]): FloorBand[] {
  const ordered = [...floors].sort((a, b) => a.level - b.level);
  if (ordered.length === 1) {
    return [{ ...ordered[0], lo: -Infinity, hi: Infinity }];
  }
  return ordered.map((floor, i) => {
    const cut = floor.level + FLOOR_BAND_ABOVE_M;
    const next = ordered[i + 1];
    return {
      name: floor.name,
      level: floor.level,
      lo: i === 0 ? -Infinity : floor.level - FLOOR_BAND_BELOW_M,
      hi: next ? Math.min(cut, next.level - FLOOR_BAND_BELOW_M) : cut,
    };
  });
}

/**
 * The ground height a waypoint placed on `band` stands at, metres. The
 * lowest floor is 0, as every waypoint was before floors and as the floor
 * plan is drawn. Any other floor is where the 3D map shows its ground
 * (`measured`), else a body height under its level.
 */
export function floorGround(band: FloorBand | null, measured: number | null = null): number {
  if (!band || band.lo === -Infinity) return 0;
  return measured ?? band.level - FLOOR_GROUND_BELOW_LEVEL_M;
}

/**
 * The floor a ground height is on, by the same bands the 3D map is drawn
 * in, or null for a map of one storey. Never stored with the waypoint: a
 * floor renamed or a list re-detected would leave a stored name pointing at
 * nothing, where a height still finds its floor.
 */
export function floorOfHeight(z: number, floors: readonly MapFloor[]): string | null {
  return floorBands(floors).find((band) => z >= band.lo && z < band.hi)?.name ?? null;
}

/**
 * What is wrong with a list the operator is about to save, in the backend's
 * own words, or null. Checked here so Save is greyed with the reason rather
 * than refused, and kept in step with `_validate_floors`.
 */
export function floorsProblem(floors: readonly MapFloor[]): string | null {
  if (floors.length > FLOORS_MAX) {
    return `Too many floors (${floors.length}); at most ${FLOORS_MAX}.`;
  }
  const names = new Set<string>();
  for (const floor of floors) {
    const label = floor.name.trim();
    if (!label) return "Every floor needs a name.";
    if (label.length > FLOOR_NAME_MAX) {
      return `Floor name '${label}' is too long; at most ${FLOOR_NAME_MAX} characters.`;
    }
    const key = label.toLowerCase();
    if (names.has(key)) return `Two floors are called '${label}'.`;
    if (!Number.isFinite(floor.level)) return `Floor '${label}' has no height.`;
    names.add(key);
  }
  const ordered = [...floors].sort((a, b) => a.level - b.level);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].level - ordered[i - 1].level < FLOOR_MIN_SEPARATION_M) {
      return `Floors '${ordered[i - 1].name.trim()}' and '${ordered[i].name.trim()}' are less than ${FLOOR_MIN_SEPARATION_M} m apart.`;
    }
  }
  return null;
}

/**
 * The floor Add floor offers: a storey above the top one, called the next
 * free `<n>F`. Somewhere to start from, which the operator then sets.
 */
export function nextFloor(floors: readonly MapFloor[]): MapFloor {
  const top = floors.reduce((max, floor) => Math.max(max, floor.level), -Infinity);
  const level = Number.isFinite(top) ? Math.round((top + NEW_FLOOR_STEP_M) * 10) / 10 : 0;
  const taken = new Set(floors.map((floor) => floor.name.trim().toLowerCase()));
  let n = floors.length + 1;
  while (taken.has(`${n}f`)) n += 1;
  return { name: `${n}F`, level };
}

/** Whether two lists name the same floors at the same heights, in any order. */
export function sameFloors(a: readonly MapFloor[], b: readonly MapFloor[]): boolean {
  if (a.length !== b.length) return false;
  const key = (floors: readonly MapFloor[]) =>
    [...floors]
      .sort((x, y) => x.level - y.level)
      .map((floor) => `${floor.name.trim()}@${floor.level}`)
      .join("|");
  return key(a) === key(b);
}
