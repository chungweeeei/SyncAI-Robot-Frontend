// Where a reading crosses from fine to worth a look to worth acting on, for
// the three levels the console colours: Wi-Fi signal, battery and joint
// temperature. Pure so the thresholds are tested rather than remembered, and
// in one place so every surface that shows a reading agrees about it.

import type { Tone } from "@/lib/types/tone";

/**
 * How many bars the Wi-Fi meter has. `rssiToBars`' cut-offs only mean
 * anything against this many, which is why the meter reads it from here
 * rather than drawing its own count: a meter with five bars would need
 * different thresholds, and the two cannot drift if they share the number.
 */
export const SIGNAL_BARS = 4;

/**
 * dBm to bars. −50 and above is a full meter, below −70 is one bar, and no
 * reading is ever zero bars, because a network that answers is not absent.
 * Every RSSI surface (status strip, telemetry rail, the Wi-Fi picker) goes
 * through this one so they never disagree about a network.
 */
export function rssiToBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  return 1;
}

/** Battery below this percentage is faulted. */
export const BATTERY_WARN_PCT = 20;
/** Battery below this percentage is degraded. */
export const BATTERY_CAUTION_PCT = 40;

/** The battery readout's tone: live while there is margin, then caution, then warn. */
export function batteryTone(pct: number): Tone {
  if (pct < BATTERY_WARN_PCT) return "warn";
  if (pct < BATTERY_CAUTION_PCT) return "caution";
  return "live";
}

// Display thresholds, in Celsius. Nothing in the stack defines a joint
// temperature limit — the driver forwards the number and nothing on the robot
// acts on it — so these exist to colour the readout, not to mean anything the
// robot agrees with. Set to flag a leg working hard well before anything is
// actually at risk; change them freely.
export const TEMP_CAUTION_C = 60;
export const TEMP_WARN_C = 80;

/**
 * A joint temperature's tone. Neutral rather than `live` below caution:
 * twelve green numbers is a wall of colour that says nothing, and the point
 * of the motor grid is that a hot joint jumps out of it.
 */
export function motorTempTone(celsius: number): Tone {
  if (celsius >= TEMP_WARN_C) return "warn";
  if (celsius >= TEMP_CAUTION_C) return "caution";
  return "neutral";
}
