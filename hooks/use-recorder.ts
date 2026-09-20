"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  deleteRecording,
  startRecording,
  stopRecording,
  type StartRecordingRequest,
} from "@/lib/api/recording";

/**
 * POST /api/v1/recordings — start the bag recorder.
 *
 * The response is the live entry `GET /recordings/active` would answer with,
 * so it is written straight into that key rather than waiting for the next
 * poll: the panel switches face on the press, not a second later. The
 * catalogue gains a row from the same event and is refetched.
 */
export function useStartRecording() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StartRecordingRequest) => startRecording(request),
    onSuccess: (started) => {
      queryClient.setQueryData(queryKeys.activeRecording, started);
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordings });
    },
  });
}

/**
 * POST /api/v1/recordings/stop — end the live recorder and wait for the bag
 * to be closed (slow on purpose; see the fetcher).
 *
 * A 409 here means the recorder was already gone — reaped after a crash, or
 * stopped from somewhere else — so the failure path re-reads the live entry:
 * the catalogue is what says which, and the panel must not keep offering Stop
 * against a recorder that no longer exists.
 */
export function useStopRecording() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopRecording(),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.activeRecording, null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordings });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeRecording });
    },
  });
}

/** DELETE /api/v1/recordings/{name}. The row unmounts with the refetch. */
export function useDeleteRecording() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteRecording(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordings });
    },
  });
}
