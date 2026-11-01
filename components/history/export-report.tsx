"use client";

import * as React from "react";
import { CheckIcon, DownloadIcon } from "lucide-react";

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
  kindLabel,
  toExportQuery,
  type ExportRangeChoice,
  type HistoryFilter,
} from "@/lib/task/history";
import { cn } from "@/lib/utils";

const OUTCOME_LABELS: Record<HistoryFilter["status"], string> = {
  ALL: "All outcomes",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

/**
 * The page header's "Export report": a dialog that picks the report's window
 * and says what it will hold before anything is downloaded.
 *
 * The window is the report's own (the list's presets stop at a day); outcome,
 * kind and name are the list's, shown read-only so the operator sees them
 * without hunting back through the toolbar. The filter is read off the
 * address bar like the list's, so this sits apart from it in the header.
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
  const datesId = React.useId();

  const pick = (next: ExportRangeChoice) => {
    setChoice(next);
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
        <DialogContent closeLabel="Close export">
          <DialogHeader>
            <DialogTitle>Export report</DialogTitle>
            <DialogDescription>
              A CSV of the finished jobs, one row per step, with how long each
              step took. Opens in Excel or Google Sheets.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="instrument-label mb-1.5 text-muted-foreground">Range</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-1.5">
              {EXPORT_RANGE_CHOICES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={choice === item.value}
                  disabled={busy}
                  onClick={() => pick(item.value)}
                  className={cn(
                    "h-8 rounded-sm border px-2.5 text-left text-[13px] transition-colors pointer-coarse:h-10",
                    choice === item.value
                      ? "border-signal-cmd bg-signal-cmd/10 font-medium text-foreground"
                      : "border-hairline text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {choice === "custom" && (
              <div
                id={datesId}
                className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-sm border border-hairline px-3 py-2"
              >
                <label className="flex flex-col gap-1">
                  <span className="instrument-label text-muted-foreground">From</span>
                  <Input
                    type="date"
                    value={dates.from}
                    // Older than the record reaches would only ever be empty.
                    min={dateInputValue(nowMs - EXPORT_RETENTION_DAYS * 86_400_000)}
                    max={dates.to}
                    onChange={(event) => {
                      setDates({ ...dates, from: event.target.value });
                      reset();
                    }}
                    className="h-8 w-auto rounded-sm text-[13px] md:text-[13px] pointer-coarse:h-10"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="instrument-label text-muted-foreground">To</span>
                  <Input
                    type="date"
                    value={dates.to}
                    min={dates.from}
                    max={dateInputValue(nowMs)}
                    onChange={(event) => {
                      setDates({ ...dates, to: event.target.value });
                      reset();
                    }}
                    className="h-8 w-auto rounded-sm text-[13px] md:text-[13px] pointer-coarse:h-10"
                  />
                </label>
              </div>
            )}
          </fieldset>

          {/* What the file will hold, before it is fetched. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-sm border border-hairline bg-panel px-3 py-2.5 text-[13px]">
            <dt className="text-muted-foreground">Window</dt>
            <dd className="readout">
              {query ? describeExportWindow(query, nowMs) : "Pick a start no later than the end"}
            </dd>
            <dt className="text-muted-foreground">Jobs</dt>
            <dd>
              {[
                OUTCOME_LABELS[filter.status],
                filter.kind ? kindLabel(filter.kind) : "All kinds",
                filter.name ?? "All names",
              ].join(" · ")}
            </dd>
            <dt className="text-muted-foreground">Times in</dt>
            <dd className="readout">{timeZone || "UTC"}</dd>
          </dl>

          <p className="text-[11px] leading-snug text-muted-foreground">
            The robot keeps this record for {EXPORT_RETENTION_DAYS} days. Jobs that
            ended before it started keeping one are listed on this page but are
            not in the report.
          </p>

          {result && result.jobs > 0 && (
            <p role="status" className="flex items-start gap-1.5 text-[13px] text-signal-live">
              <CheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Saved <span className="readout break-all">{result.filename}</span> ·{" "}
                {result.jobs} {result.jobs === 1 ? "job" : "jobs"}
              </span>
            </p>
          )}
          {result && result.jobs === 0 && (
            <p role="status" className="text-[13px] text-signal-caution">
              No recorded jobs in this window, so nothing was saved. Try a wider
              range, or check the outcome, kind and name filters.
            </p>
          )}
          {exportReport.error && (
            <p role="alert" className="text-[13px] text-signal-warn">
              {exportReport.error.message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {result?.jobs ? "Done" : "Cancel"}
            </Button>
            <Button
              type="button"
              disabled={busy || query === null}
              aria-busy={busy || undefined}
              onClick={() => query && exportReport.mutate({ query, timeZone })}
            >
              <DownloadIcon aria-hidden />
              {busy ? "Exporting…" : result?.jobs ? "Download again" : "Download CSV"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
