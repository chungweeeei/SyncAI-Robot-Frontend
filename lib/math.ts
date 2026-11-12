// The arithmetic more than one screen needs and no domain owns.

/** `value` held inside `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
