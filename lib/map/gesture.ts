// The gesture rules every canvas shares: when a drag is a drag, which way it
// aims, and how far a toolbar zoom goes. Pure, so every surface uses one copy (two
// once had deadzones drifting to 8 and 10 px).

/**
 * CSS px below which a press that moved is still a click, for every use on
 * every surface. Screen px, not metres, which would vary with perspective.
 */
export const DRAG_DEADZONE_PX = 10;

/**
 * One toolbar Zoom in / out step (camera distance). √2 so two presses are exactly one doubling.
 */
export const ZOOM_STEP_FACTOR = Math.SQRT2;

/** Whether a pointer that went from one screen point to another dragged. */
export function isDrag(fromX: number, fromY: number, toX: number, toY: number): boolean {
  return Math.hypot(toX - fromX, toY - fromY) >= DRAG_DEADZONE_PX;
}

/**
 * The heading in degrees of a map-frame displacement (x right, y up, CCW
 * positive), or null for none — a zero vector has no direction, so the caller
 * keeps its heading. A 3D view passes a floor-raycast world delta, since its
 * camera can face any way.
 */
export function headingDegrees(dx: number, dy: number): number | null {
  if (dx === 0 && dy === 0) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}
