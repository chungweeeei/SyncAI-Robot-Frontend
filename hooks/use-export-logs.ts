"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { exportLogs } from "@/lib/api/logs";
import { downloadBlob } from "@/lib/download";
import { logBundleFilename } from "@/lib/logs/filename";

export interface ExportLogsResult {
  filename: string;
  bytes: number;
}

/**
 * GET /api/v1/logs/export, handed to the operator as a file, with the
 * transfer's progress in percent as `useExportMap` reports a map's.
 *
 * `progress` is null until the first byte: the robot builds the whole bundle
 * first, which has no total to measure. `startedAt` is when the press was,
 * so the screen can count that wait instead, which can be a couple of
 * minutes. Nothing is cached: a bundle is read once and saved.
 */
export function useExportLogs(robotId: string | null | undefined) {
  const [progress, setProgress] = React.useState<number | null>(null);
  const [startedAt, setStartedAt] = React.useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: async (): Promise<ExportLogsResult> => {
      const bundle = await exportLogs((fraction) => setProgress(Math.floor(fraction * 100)));
      const filename = logBundleFilename(robotId, Date.now());
      downloadBlob(bundle, filename);
      return { filename, bytes: bundle.size };
    },
    onMutate: () => {
      setProgress(null);
      setStartedAt(Date.now());
    },
    onSettled: () => {
      setProgress(null);
      setStartedAt(null);
    },
  });
  return {
    ...mutation,
    progress: mutation.isPending ? progress : null,
    startedAt: mutation.isPending ? startedAt : null,
  };
}
