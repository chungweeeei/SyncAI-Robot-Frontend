import type { MappingStatus } from "@/lib/api/mapping";

/**
 * Which face the mapping screen's run strip shows, and what its indicator
 * says — the one rule that decides what the operator is offered.
 *
 * The run is bracketed by two presses, Start and Save, and the robot accepts
 * each only in one state: Start wants `idle`, Save and a reset want
 * `mapping`. So the strip offers exactly what the robot would accept, read
 * off `GET /api/v1/mapping` rather than off a flag this tab set — a run
 * started from another console, or a save that landed there, has to read the
 * same here, and after a reload the strip has to know whether Start or Save
 * is the next thing to offer.
 *
 * Anything the console cannot vouch for fails closed: a poll still loading,
 * a failed one, or the robot's own `unknown` all hold every button, the way
 * the map job lock refuses rather than assumes.
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
  /**
   * A run is on: the recording indicator, then Save and New map. The dot
   * alone, by request — the keyframe count beside it was dropped (2026-10).
   */
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
      // "unknown": the backend has not heard the mapper, which on a robot that
      // reports Mapping means the session is still coming up — or that this
      // console is older than the robot's backend.
      return { kind: "held", readout: "Unknown" };
  }
}
