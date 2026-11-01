"use client";

import { useMutation } from "@tanstack/react-query";

import { exportTaskHistory, type TaskHistoryFilterQuery } from "@/lib/api/task";
import { downloadBlob } from "@/lib/download";
import { countReportJobs, exportFilename } from "@/lib/task/history";

export interface ExportTaskHistoryVariables {
  query: TaskHistoryFilterQuery;
  /** The browser's zone, or "" before it has said (the report is then UTC). */
  timeZone: string;
}

export interface ExportTaskHistoryResult {
  /** Jobs in the report; 0 means nothing was saved. */
  jobs: number;
  /** The file it was saved as; null when nothing was. */
  filename: string | null;
}

/**
 * GET /api/v1/task_history/export, handed to the operator as a file. Named
 * here, on the operator's calendar, because CORS may hide the server's name.
 *
 * Counted before it is saved: a report with no jobs is a header and nothing
 * else, which says nothing to a customer, so it is not saved and the caller
 * says why instead. Nothing is cached: a report is read once and saved.
 */
export function useExportTaskHistory() {
  return useMutation({
    mutationFn: async ({
      query,
      timeZone,
    }: ExportTaskHistoryVariables): Promise<ExportTaskHistoryResult> => {
      const report = await exportTaskHistory(query, timeZone);
      const jobs = countReportJobs(await report.text());
      if (!jobs) return { jobs, filename: null };
      const filename = exportFilename(query, Date.now());
      downloadBlob(report, filename);
      return { jobs, filename };
    },
  });
}
