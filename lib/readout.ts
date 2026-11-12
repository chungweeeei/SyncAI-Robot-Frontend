// How a pose is printed, once: every readout, and every field seeded from
// one, shows the same digits for the same pose. Centimetres and tenths of a
// degree are what the robot's localization is good for; more would be noise
// an operator reads as precision.

/** Metres, to the centimetre: `1.50`. */
export function formatMetres(value: number): string {
  return value.toFixed(2);
}

/** Degrees, to the tenth: `90.0`. */
export function formatDegrees(value: number): string {
  return value.toFixed(1);
}
