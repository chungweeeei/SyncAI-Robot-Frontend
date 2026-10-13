import type { MappingStatus } from "@/lib/api/mapping";

/**
 * Which face the mapping run strip shows, and what its indicator says.
 *
 * Start needs `idle`, Save and reset need `mapping`, so the strip offers what
 * the robot would accept — read off `GET /api/v1/mapping`, not a local flag,
 * so another console's run and a reload read the same. Anything unvouched for
 * (loading, failed, `unknown`) holds every button.
 */
export interface RunFaceInput {
  /** The robot reports Mapping and no switch is pending. */
  inMapping: boolean;
  /** The latest answer of the run-status poll, or null before the first one. */
  run: MappingStatus | null;
  status: "loading" | "ok" | "error";
}

export type RunFace =
  /** Nothing is running: offer Start. `enabled` is false in the wrong mode, and `reason` says so. */
  | { kind: "start"; enabled: boolean; reason: string | null }
  /** A run is on: the recording indicator (the dot alone, by request), then Save and New map. */
  | { kind: "run" }
  /** The robot is between states or unreadable: the indicator alone, every button held. */
  | { kind: "held"; readout: string };

export const START_NEEDS_MAPPING_MODE = "Starting a map needs mapping mode.";

export function mappingRunFace({ inMapping, run, status }: RunFaceInput): RunFace {
  if (!inMapping) {
    return { kind: "start", enabled: false, reason: START_NEEDS_MAPPING_MODE };
  }
  if (run === null) {
    return status === "loading"
      ? { kind: "held", readout: "Checking…" }
      : { kind: "held", readout: "Unknown" };
  }
  switch (run.state) {
    case "idle":
      return { kind: "start", enabled: true, reason: null };
    case "mapping":
      return { kind: "run" };
    case "resetting":
      return { kind: "held", readout: "Resetting…" };
    default:
      // "unknown": the mapper is still coming up, or this console predates the backend.
      return { kind: "held", readout: "Unknown" };
  }
}
