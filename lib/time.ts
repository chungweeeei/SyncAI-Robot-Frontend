/** A day, milliseconds. */
export const DAY_MS = 86_400_000;

/** Two digits, zero-padded: a clock's hour or minute, a date's month or day. */
export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
