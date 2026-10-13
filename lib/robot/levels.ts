// Readout thresholds for Wi-Fi signal, battery and joint temperature, in one
// place so every surface agrees.

import type { Tone } from "@/lib/types/tone";

/** The meter's bar count; `rssiToBars`' cut-offs only hold against it. */
export const SIGNAL_BARS = 4;

/** dBm to bars. Never zero: a network that answers is not absent. */
export function rssiToBars(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  return 1;
}

export const BATTERY_WARN_PCT = 20;
export const BATTERY_CAUTION_PCT = 40;

export function batteryTone(pct: number): Tone {
  if (pct < BATTERY_WARN_PCT) return "warn";
  if (pct < BATTERY_CAUTION_PCT) return "caution";
  return "live";
}

// Display thresholds, °C. Nothing on the robot defines or acts on a joint
// temperature limit; these only colour the readout. Change them freely.
export const TEMP_CAUTION_C = 60;
export const TEMP_WARN_C = 80;

/**
 * Strictly above this, a notice the operator must dismiss (85 °C by request;
 * see lib/robot/heat-alert.ts). Red starts five degrees earlier so the notice
 * never lands on a grid that looked calm.
 */
export const TEMP_ALERT_C = 85;

/** Neutral, not `live`, below caution, so a hot joint jumps out of the grid. */
export function motorTempTone(celsius: number): Tone {
  if (celsius >= TEMP_WARN_C) return "warn";
  if (celsius >= TEMP_CAUTION_C) return "caution";
  return "neutral";
}
