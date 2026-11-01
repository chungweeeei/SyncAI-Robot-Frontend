"use client";

import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useExportTaskHistory } from "@/hooks/use-export-task-history";
import type { TaskHistoryFilterQuery } from "@/lib/api/task";

/**
 * Download the jobs under the current filter as a CSV report, one row per
 * step, times on the operator's clock.
 *
 * The report reads the robot's own record (30 days), not the orchestrator's
 * index the list reads, so the two can disagree at the edges: a job that
 * ended before the robot kept records is listed but not exported. The note
 * says how far back it reaches rather than leaving it to a customer's sheet.
 */
export function ExportReport({
  query,
  timeZone,
}: {
  query: TaskHistoryFilterQuery;
  /** The browser's zone, or "" before it has said (the report is then UTC). */
  timeZone: string;
}) {
  const exportReport = useExportTaskHistory();
  const busy = exportReport.isPending;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 rounded-sm pointer-coarse:h-10"
        disabled={busy}
        aria-busy={busy || undefined}
        onClick={() => exportReport.mutate({ query, timeZone })}
      >
        <DownloadIcon aria-hidden />
        {busy ? "Exporting…" : "Export CSV"}
      </Button>
      <span className="text-[11px] leading-tight text-muted-foreground">
        One row per step, for these filters. Kept 30 days.
      </span>
      {exportReport.error && (
        <p role="alert" className="w-full text-[11px] leading-snug text-signal-warn">
          {exportReport.error.message}
        </p>
      )}
    </div>
  );
}
