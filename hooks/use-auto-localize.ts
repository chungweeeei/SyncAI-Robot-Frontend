"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useActiveTasksSelect } from "@/hooks/use-console-active-tasks";
import { useRobotStateSelect } from "@/hooks/use-console-robot-state";
import { autoLocalize, type AutoLocalizeResult } from "@/lib/api/localization";
import { ignore } from "@/lib/api/mutation-state";
import type { ActiveTasksResponse } from "@/lib/api/task";
import { autoLocalizeLock } from "@/lib/map/run-lock";
import type { RobotState } from "@/lib/types/robot";

const robotMode = (state: RobotState) => state.mode;
const anyRunning = (list: ActiveTasksResponse) => list.tasks.length > 0;
const RUNNING: readonly unknown[] = [true];
const IDLE: readonly unknown[] = [];

/**
 * How long a match stays on screen. Longer than the initial pose's receipt:
 * these numbers are new to the operator and worth a second read.
 */
const CLEAR_AFTER_MATCH_MS = 5000;

export interface AutoLocalize {
  /** The last match, until it clears itself. */
  result: AutoLocalizeResult | null;
  /** The robot is searching (up to ~15 s). */
  busy: boolean;
  error: string | null;
  /** Why the button is greyed, or null when it may be pressed. */
  lock: string | null;
  run: () => Promise<void>;
  clear: () => void;
}

/**
 * Ask the robot to find itself on the loaded map with no hint. A command, so
 * it invalidates nothing; unlike an initial pose it *answers* — a 200 is a
 * match that held, and its numbers are the read-back. Only a success clears
 * itself; a failure stays beside its Retry.
 */
export function useAutoLocalize(): AutoLocalize {
  // The two facts the lock is made of, selected off the console's polls: the
  // whole frame and the whole list move every read, and this hook is mounted
  // in the dashboard's viewport, which would re-render with them.
  const mode = useRobotStateSelect(robotMode) ?? null;
  const { data: running, status } = useActiveTasksSelect(anyRunning);
  const lock = autoLocalizeLock({
    mode,
    // The rule reads only whether there is one.
    tasks: running ? RUNNING : IDLE,
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
