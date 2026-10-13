import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchActiveRecording,
  fetchRecordings,
  type ActiveRecording,
  type RecordingSummary,
} from "@/lib/api/recording";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * Live recorder re-read while one runs. This poll *is* the elapsed clock: the
 * readout shows the robot's own `elapsed_seconds`, not a local timer, so it
 * never claims a liveness the connection does not have.
 */
const ACTIVE_POLL_MS = 1000;

/**
 * Still polled while idle: a recording started from another console would
 * otherwise meet a Start that 409s.
 */
const IDLE_POLL_MS = 5000;

/**
 * Catalogue re-read only while a recording is live, whose size grows on its
 * own; every other change is a write this console invalidates for.
 */
const RECORDING_POLL_MS = 2000;

function pollWhileRecording(
  recordings: RecordingSummary[] | undefined,
): number | false {
  return recordings?.some((entry) => entry.status === "recording")
    ? RECORDING_POLL_MS
    : false;
}

export type RecordingsStatus = "loading" | "ok" | "error";

export interface UseActiveRecording {
  /** Null means "nothing is recording" — a real answer. */
  active: ActiveRecording | null;
  /** A later failure keeps the last answer. */
  status: RecordingsStatus;
}

/**
 * The live recorder, polled. Its own entry rather than a view of the
 * catalogue: this is one slot in backend memory, the catalogue a directory
 * walk per recording. `status` tells a server null from "no answer yet", so
 * the panel does not flash its idle form on mount.
 */
export function useActiveRecording(): UseActiveRecording {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.activeRecording,
    queryFn: ({ signal }) => fetchActiveRecording(signal),
    refetchInterval: (query) =>
      query.state.data ? ACTIVE_POLL_MS : IDLE_POLL_MS,
  });

  return {
    active: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
  };
}

export interface UseRecordings {
  /** Null before the first success. */
  recordings: RecordingSummary[] | null;
  status: RecordingsStatus;
  refresh: () => void;
}

/** The recording catalogue; the same policy as useMaps. */
export function useRecordings(): UseRecordings {
  const queryClient = useQueryClient();
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.recordings,
    queryFn: ({ signal }) => fetchRecordings(signal),
    refetchInterval: (query) => pollWhileRecording(query.state.data),
  });

  // Invalidate rather than refetch(): the entry is shared by every observer.
  const refresh = React.useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.recordings }),
    [queryClient],
  );

  return {
    recordings: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    refresh,
  };
}
