"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  InfoIcon,
} from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useExportTaskHistory } from "@/hooks/use-export-task-history";
import { useHistoryFilter } from "@/hooks/use-history-filter";
import {
  EXPORT_RANGE_CHOICES,
  EXPORT_RETENTION_DAYS,
  dateInputValue,
  describeExportWindow,
  exportDatesSeed,
  exportFilename,
  kindLabel,
  toExportQuery,
  type ExportRangeChoice,
  type HistoryFilter,
} from "@/lib/task/history";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;

const OUTCOME_LABELS: Record<Exclude<HistoryFilter["status"], "ALL">, string> = {
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

/** The list's narrowing, as chips; empty when it narrows nothing. */
function filterChips(filter: HistoryFilter): string[] {
  const chips: string[] = [];
  if (filter.status !== "ALL") chips.push(OUTCOME_LABELS[filter.status]);
  if (filter.kind) chips.push(kindLabel(filter.kind));
  if (filter.name) chips.push(filter.name);
  return chips;
}

const DATE_INPUT =
  "h-8 w-auto min-w-0 flex-1 rounded-sm text-[13px] md:text-[13px] pointer-coarse:h-10";

/**
 * The page header's "Export report": a dialog that picks the report's window
 * and shows the file it will produce before anything is downloaded.
 *
 * The window is the report's own (the list's presets stop at a day); outcome,
 * kind and name are the list's, shown as chips on the file so the operator
 * sees them without hunting back through the toolbar. The filter is read off
 * the address bar like the list's, so this sits apart from it in the header.
 */
export function ExportReport() {
  const { filter } = useHistoryFilter();
  const timeZone = useBrowserTimeZone();
  const exportReport = useExportTaskHistory();
  const { reset } = exportReport;

  const [open, setOpen] = React.useState(false);
  // Taken when the dialog opens, so "last 7 days" means the same thing for as
  // long as it is open, and the page's 1 Hz re-render moves nothing.
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [choice, setChoice] = React.useState<ExportRangeChoice>("7d");
  const [dates, setDates] = React.useState(() => exportDatesSeed(Date.now()));

  const query = toExportQuery(filter, choice, dates, nowMs);
  const busy = exportReport.isPending;
  const result = exportReport.data;
  const chips = filterChips(filter);

  const setDate = (bound: "from" | "to", value: string) => {
    setDates({ ...dates, [bound]: value });
    reset();
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => {
          const now = Date.now();
          setNowMs(now);
          setDates(exportDatesSeed(now));
          reset();
          setOpen(true);
        }}
      >
        <DownloadIcon aria-hidden />
        Export report
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && busy) return;
          setOpen(next);
        }}
      >
        <DialogContent closeLabel="Close export" className="gap-5 p-5">
          <DialogHeader>
            <DialogTitle>Export report</DialogTitle>
            <DialogDescription>
              Finished jobs as a CSV, one row per step, with how long each step
              took.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <span className="instrument-label text-muted-foreground">Range</span>
            <Segmented
              label="Range"
              value={choice}
              options={EXPORT_RANGE_CHOICES}
              stretch
              disabled={busy}
              className="[&>button]:h-8"
              onChange={(next) => {
                setChoice(next);
                reset();
              }}
            />
            {choice === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label="From"
                  value={dates.from}
                  // Older than the record reaches would only ever be empty.
                  min={dateInputValue(nowMs - EXPORT_RETENTION_DAYS * DAY_MS)}
                  max={dates.to}
                  onChange={(event) => setDate("from", event.target.value)}
                  className={DATE_INPUT}
                />
                <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  type="date"
                  aria-label="To"
                  value={dates.to}
                  min={dates.from}
                  max={dateInputValue(nowMs)}
                  onChange={(event) => setDate("to", event.target.value)}
                  className={DATE_INPUT}
                />
              </div>
            )}
          </div>

          {/* The file it will produce: name, window, zone, and the list's
            * narrowing. The outcome of the last download lands on it. */}
          <div
            className={cn(
              "rounded-md border bg-panel transition-colors",
              result?.jobs ? "border-signal-live/50" : "border-hairline",
            )}
          >
            <div className="flex items-start gap-3 p-3">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-sm",
                  result?.jobs
                    ? "bg-signal-live/12 text-signal-live"
                    : "bg-elevated text-muted-foreground",
                )}
              >
                {result?.jobs ? (
                  <CheckIcon className="size-4.5" aria-hidden />
                ) : (
                  <FileSpreadsheetIcon className="size-4.5" aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="readout truncate text-[13px] font-medium">
                  {query ? exportFilename(query, nowMs) : "task-report.csv"}
                </p>
                <p className="readout text-[12px] text-muted-foreground">
                  {query ? describeExportWindow(query, nowMs) : "Pick a start no later than the end"}
                  {" · "}
                  {timeZone || "UTC"}
                </p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {chips.length ? (
                    chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-sm border border-hairline bg-background px-1.5 py-0.5 text-[11px] leading-none"
                      >
                        {chip}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] leading-none text-muted-foreground">
                      Every outcome, kind and name
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(result || exportReport.error) && (
              <p
                role={exportReport.error ? "alert" : "status"}
                className={cn(
                  "border-t px-3 py-2 text-[12px] leading-snug",
                  exportReport.error
                    ? "border-hairline text-signal-warn"
                    : result?.jobs
                      ? "border-signal-live/30 text-signal-live"
                      : "border-hairline text-signal-caution",
                )}
              >
                {exportReport.error
                  ? exportReport.error.message
                  : result?.jobs
                    ? `Saved · ${result.jobs} ${result.jobs === 1 ? "job" : "jobs"}`
                    : "No recorded jobs in this window, so nothing was saved. Try a wider range or fewer filters."}
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground sm:max-w-64">
              <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
              Kept {EXPORT_RETENTION_DAYS} days on the robot. Jobs from before it
              began keeping them are not included.
            </p>
            <div className="flex gap-2 sm:shrink-0">
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                {result?.jobs ? "Done" : "Cancel"}
              </Button>
              <Button
                type="button"
                className="flex-1 sm:flex-none"
                disabled={busy || query === null}
                aria-busy={busy || undefined}
                onClick={() => query && exportReport.mutate({ query, timeZone })}
              >
                <DownloadIcon aria-hidden />
                {busy ? "Exporting…" : result?.jobs ? "Download again" : "Download"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
