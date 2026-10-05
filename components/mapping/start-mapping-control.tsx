"use client";

import { PlayIcon } from "lucide-react";

import { InstrumentGroup, Readout } from "@/components/console/instrument";
import { Button } from "@/components/ui/button";
import { useStartMapping } from "@/hooks/use-mapping-run";
import type { UseMappingStatus } from "@/hooks/use-mapping-run";
import type { Tone } from "@/lib/types/tone";

/**
 * Whether Start may be pressed, and if not, why — the rail's one sentence.
 *
 * `running` and `busy` are the robot's own refusals (409 `mapping_running` /
 * `mapping_busy`), known before the press from the status poll; `wrong-mode`
 * is the page's. Separate from Save's availability because they are opposite
 * readings of the same state: Start wants idle, Save wants a run.
 */
export type StartAvailability = "ready" | "running" | "busy" | "wrong-mode";

const CAPTION: Record<StartAvailability, string> = {
  ready:
    "The robot is in mapping mode but not building a map yet. Keep it still and press Start — its sensors level themselves first.",
  running: "Drive the robot around to grow the map. Save when the floor is covered.",
  busy: "The robot is starting or resetting the map. This takes a few seconds.",
  "wrong-mode": "Starting a map needs mapping mode.",
};

/** The status readout: what the robot says the run is, in its own tone. */
function runReadout(
  status: UseMappingStatus,
  availability: StartAvailability,
): { value: string; tone: Tone } {
  if (availability === "wrong-mode") return { value: "—", tone: "neutral" };
  const run = status.run;
  if (run === null) {
    return status.status === "loading"
      ? { value: "Checking…", tone: "neutral" }
      : { value: "Unknown", tone: "caution" };
  }
  switch (run.state) {
    case "mapping":
      return {
        value: `Mapping · ${run.key_poses} keyframe${run.key_poses === 1 ? "" : "s"}`,
        tone: "live",
      };
    case "idle":
      return { value: "Idle — press Start mapping", tone: "neutral" };
    case "resetting":
      return { value: "Resetting…", tone: "caution" };
    default:
      // "unknown": the backend has not heard pgo, which on a robot that
      // reports Mapping means the session is still coming up — or that this
      // console is older than the robot's backend.
      return { value: "Unknown", tone: "caution" };
  }
}

/**
 * Begin a mapping run.
 *
 * The run's opening bracket (2026-10): the robot comes up in mapping mode with
 * nothing banked, so the drive from wherever it was switched on to the site's
 * starting point is not part of any map, and the save below ends the run and
 * leaves the robot idle for the next one. Placed above Save on purpose — the
 * rail reads mode → start → save → start over, in the order the operator does
 * them.
 *
 * Owns its own request, in SaveMapControl's idiom rather than ResetRunControl's:
 * starting needs no permission from the page. It also goes through **no
 * confirm dialog**, and that is a decision against this page's one rule
 * ("every act that rebuilds or discards something is confirmed"): a start
 * rebuilds nothing and discards nothing — the stack stays up and there is no
 * run to lose, which the robot itself guarantees by refusing a start while a
 * run is on. Its one hazard, the robot having to stand still while the lidar
 * re-levels, is the same hazard the reset control already carries in its
 * caption rather than in a dialog.
 *
 * `onStarted` is how the page learns a new unsaved run exists: its
 * leave-without-saving guard re-arms on that, since the reported mode never
 * changes across a start.
 */
export function StartMappingControl({
  availability,
  status,
  onStarted,
}: {
  availability: StartAvailability;
  status: UseMappingStatus;
  onStarted: () => void;
}) {
  const start = useStartMapping();
  const busy = start.isPending;
  // The backend's own sentences, written to be shown: the stillness warning
  // on success, the wrong-mode 502 or a refusal on failure.
  const done = start.data?.message ?? null;
  const error = start.error?.message ?? null;
  const readout = runReadout(status, availability);

  return (
    <InstrumentGroup label="Mapping run" caption={CAPTION[availability]}>
      <Readout label="Status" value={readout.value} tone={readout.tone} />

      <Button
        type="button"
        size="sm"
        disabled={availability !== "ready" || busy}
        onClick={() => start.mutate(undefined, { onSuccess: onStarted })}
        className="w-full"
      >
        <PlayIcon data-icon="inline-start" />
        {busy ? "Starting…" : "Start mapping"}
      </Button>

      {done && <p className="text-[11px] leading-snug text-signal-live">{done}</p>}

      {error && (
        <p className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}
    </InstrumentGroup>
  );
}
