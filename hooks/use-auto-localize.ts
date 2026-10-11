"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { autoLocalize, type AutoLocalizeResult } from "@/lib/api/localization";
import { ignore } from "@/lib/api/mutation-state";
import { autoLocalizeLock } from "@/lib/map/run-lock";

/**
 * How long a match stays on screen before it clears itself.
 *
 * Longer than the initial pose's receipt: that one echoes numbers the operator
 * placed by eye a moment ago, while these are new — where the robot decided it
 * is, and how well the match held — and are worth a second read.
 */
const CLEAR_AFTER_MATCH_MS = 5000;

export interface AutoLocalize {
  /** The last match, until it clears itself; null otherwise. */
  result: AutoLocalizeResult | null;
  /** True while the robot is searching — up to ~15 s. */
  busy: boolean;
  /** The backend's sentence for the last failure, verbatim. */
  error: string | null;
  /** Why the button is greyed right now, or null when it may be pressed. */
  lock: string | null;
  run: () => Promise<void>;
  clear: () => void;
}

/**
 * Auto localize: ask the robot to find itself on the loaded map with no hint.
 *
 * A command, so it invalidates nothing — the 1 Hz robot-state poll and the
 * telemetry pose are what show the robot snapping to where it was found. The
 * response is still read, because unlike an initial pose this request
 * *answers*: a 200 is a match that held, and its numbers are the read-back.
 *
 * Only a success clears itself; a failure stays, because its panel is the one
 * place the sentence and the Retry live.
 */
export function useAutoLocalize(): AutoLocalize {
  const { state } = useConsoleRobotState();
  const { tasks, status } = useConsoleActiveTasks();
  const lock = autoLocalizeLock({
    mode: state?.mode ?? null,
    tasks,
    status,
  });

  const mutation = useMutation({ mutationFn: autoLocalize });
  const { mutateAsync, reset, isSuccess } = mutation;

  React.useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(reset, CLEAR_AFTER_MATCH_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, reset]);

  const run = React.useCallback(async () => {
    await mutateAsync().catch(ignore);
  }, [mutateAsync]);

  return {
    result: mutation.data ?? null,
    busy: mutation.isPending,
    error: mutation.error?.message ?? null,
    lock: lock.reason,
    run,
    clear: reset,
  };
}
