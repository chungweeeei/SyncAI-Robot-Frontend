/**
 * Heading arithmetic, in the degrees the whole REST vocabulary speaks.
 *
 * Its own module rather than a corner of lib/api/task.ts, where it was first
 * written, because a heading is not a task: four lib/ modules, two hooks and a
 * step row all fold an angle, and only one of them is dispatching anything.
 * Living under a fetcher also meant a component that needed nothing but this
 * function had to import from the REST client to get it, which is the layering
 * break CLAUDE.md names.
 */

/**
 * Fold a heading into (-180, 180].
 *
 * Exactly -180 is excluded on purpose: the backend's MoveParams validates
 * `gt=-180, le=180`, so the usual [-180, 180) would produce the one value it
 * rejects. Anything that reaches the wire goes through here first.
 */
export function normalizeTheta(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360; // [0, 360)
  return wrapped > 180 ? wrapped - 360 : wrapped;
}
