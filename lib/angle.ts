/**
 * Fold a heading (degrees) into (-180, 180].
 *
 * Not the usual [-180, 180): the backend validates `gt=-180, le=180`, so -180
 * is the one value it rejects.
 */
export function normalizeTheta(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360; // [0, 360)
  return wrapped > 180 ? wrapped - 360 : wrapped;
}
