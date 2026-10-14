/**
 * The colour ramp the 3D map is drawn with, by height: the same stops on the
 * dashboard's voxel layer (three.js, a number per channel) and the ground
 * editor's top-down raster (a 2D context, bytes). Data colouring rather than
 * a signal hue, which is why it is not in signal.ts: a floor two storeys up
 * must not read as a command, a fault or a live value.
 *
 * Violet at the lowest voxel through blue, green and yellow to red at the
 * highest — the same ramp as the robot's own viewer, so a floor an engineer
 * saw there looks the same here.
 */
export const HEIGHT_RAMP: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0, [48, 18, 59]],
  [0.15, [70, 107, 227]],
  [0.35, [41, 187, 236]],
  [0.5, [49, 241, 140]],
  [0.65, [164, 252, 60]],
  [0.8, [238, 207, 58]],
  [0.92, [251, 128, 34]],
  [1, [180, 25, 4]],
];

/**
 * The ramp at `t` in [0, 1], written into `out` as 0–1 floats (three.js's
 * vertex colours). A 2D context multiplies by 255. Clamped, since the range
 * is a percentile band and a few voxels lie outside it on purpose.
 */
export function rampColor(t: number, out: [number, number, number]): [number, number, number] {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  for (let i = 1; i < HEIGHT_RAMP.length; i += 1) {
    if (u > HEIGHT_RAMP[i][0]) continue;
    const [t0, a] = HEIGHT_RAMP[i - 1];
    const [t1, b] = HEIGHT_RAMP[i];
    const f = (u - t0) / (t1 - t0);
    out[0] = (a[0] + (b[0] - a[0]) * f) / 255;
    out[1] = (a[1] + (b[1] - a[1]) * f) / 255;
    out[2] = (a[2] + (b[2] - a[2]) * f) / 255;
    return out;
  }
  const last = HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1];
  out[0] = last[0] / 255;
  out[1] = last[1] / 255;
  out[2] = last[2] / 255;
  return out;
}

/** The most values `heightRange` sorts; a stride over the rest reads the same band. */
export const RANGE_SAMPLE_LIMIT = 200_000;

/**
 * The band the ramp is stretched over: the 1st to 99th percentile of the
 * heights, so a few stray voxels under the floor or on a lamp do not flatten
 * every storey into one hue. Reads every `stride`-th value of a strided view
 * (`values[offset + k * stride]`), so a flat xyz array can be sampled for z
 * without a copy. A single height, or none, gives a zero-width band the
 * ramp's clamp handles.
 */
export function heightRange(
  values: ArrayLike<number>,
  offset = 0,
  stride = 1,
): { lo: number; hi: number } {
  const total = Math.floor((values.length - offset + stride - 1) / stride);
  if (total <= 0) return { lo: 0, hi: 0 };
  const n = Math.min(total, RANGE_SAMPLE_LIMIT);
  const sample = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    sample[i] = values[offset + Math.floor((i * total) / n) * stride];
  }
  sample.sort();
  return { lo: sample[Math.floor((n - 1) * 0.01)], hi: sample[Math.floor((n - 1) * 0.99)] };
}
