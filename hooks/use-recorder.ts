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
 * POST /api/v1/recordings — start the recorder. The response is the live
 * entry, so it is written straight into that key and the panel switches on
 * the press.
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
 * POST /api/v1/recordings/stop — end the recorder and wait for the file to
 * close (slow; see the fetcher). A 409 means it was already gone, so a failure
 * re-reads the live entry rather than keep offering Stop.
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
