"use client";

import { useMutation } from "@tanstack/react-query";

import { exportTaskHistory, type TaskHistoryFilterQuery } from "@/lib/api/task";
import { downloadBlob } from "@/lib/download";
import { exportFilename } from "@/lib/task/history";

export interface ExportTaskHistoryVariables {
  query: TaskHistoryFilterQuery;
  /** The browser's zone, or "" before it has said (the report is then UTC). */
  timeZone: string;
}

/**
 * GET /api/v1/task_history/export, handed to the operator as a file. Named
 * here, on the operator's calendar, because CORS may hide the server's name.
 * Nothing is cached: a report is read once and saved.
 */
export function useExportTaskHistory() {
  return useMutation({
    mutationFn: ({ query, timeZone }: ExportTaskHistoryVariables) =>
      exportTaskHistory(query, timeZone),
    onSuccess: (report, { query }) =>
      downloadBlob(report, exportFilename(query, Date.now())),
  });
}
