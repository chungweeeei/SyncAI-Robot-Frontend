/**
 * Whether a typed channel name can be handed to the recorder without the
 * request being obviously wasted: not empty, and no whitespace.
 *
 * Deliberately permissive. The robot's own name rules are stricter than this,
 * and the backend does not check them either, because a channel that does not
 * exist *yet* is a legitimate thing to arm a recorder against.
 */
export function isUsableChannel(name: string): boolean {
  return name.length > 0 && !/\s/.test(name);
}
