// The drive panel's posture keys, beside the sticks' (stick.ts). Physical
// codes, as there, so a layout other than QWERTY keeps them in place.

import type { Posture } from "@/lib/api/task";

/**
 * R stands, F lies down: the two keys over and under the left hand's WASD,
 * up for up. Neither is a stick key, so a posture never rides a drive key,
 * and each fires once per press (a held key is not a second request).
 */
export const POSTURE_KEYS: Readonly<Record<Posture, { code: string; label: string }>> = {
  STANDUP: { code: "KeyR", label: "R" },
  LIEDOWN: { code: "KeyF", label: "F" },
};

/** The posture a key code asks for, or null when it is not a posture key. */
export function postureForKey(code: string): Posture | null {
  for (const [posture, key] of Object.entries(POSTURE_KEYS) as [Posture, { code: string }][]) {
    if (key.code === code) return posture;
  }
  return null;
}
