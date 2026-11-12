"use client";

import * as React from "react";

import { useActiveTasksSelect } from "@/hooks/use-console-active-tasks";
import type { ActiveTasksResponse } from "@/lib/api/task";
import { mapRunLock, type RunLock } from "@/lib/map/run-lock";

/**
 * Whether `mapName` is held still by a running job, off the console's shared
 * active-tasks poll — no request of its own. The rule, and why it fails
 * closed, is lib/map/run-lock.ts.
 *
 * Selected off the list rather than read through the context, so a map card
 * or a map view is re-rendered when the verdict changes and not on every
 * read of the list.
 */
export function useMapRunLock(mapName: string | null): RunLock {
  const select = React.useCallback(
    (list: ActiveTasksResponse) => mapRunLock({ mapName, tasks: list.tasks, status: "ok" }),
    [mapName],
  );
  const { data, status } = useActiveTasksSelect(select);
  // Not the selected verdict while the list is loading or failing: on an
  // error the entry keeps its last good list, which would miss a job started
  // since. `mapRunLock` answers that case itself.
  const { locked, reason } =
    status === "ok" && data ? data : mapRunLock({ mapName, tasks: [], status });
  // Memoised so a status flip that changed nothing here keeps the same object.
  return React.useMemo(() => ({ locked, reason }), [locked, reason]);
}
