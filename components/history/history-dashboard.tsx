"use client";

import * as React from "react";

import { TONE_TEXT, type Tone } from "@/components/console/instrument";
import { Notice } from "@/components/history/notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import type { UseTaskHistoryStats } from "@/hooks/use-task-history-stats";
import type { TaskHistoryStatus } from "@/lib/api/task";
import { formatCount } from "@/lib/recording/format";
import { chartRows, formatPercent, type HistoryChartRow } from "@/lib/task/history";
import { formatLocalRunTime, formatUtcRunTime } from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/**
 * The same hue the outcome's chip wears on every row below, so a segment in
 * the bar and the chip on a job it counts are one colour. Via the tone tokens
 * rather than a chart palette: these are outcomes, and the console already
 * has a word for each.
 */
const OUTCOME_TONE: Record<TaskHistoryStatus, Tone> = {
  COMPLETED: "live",
  FAILED: "warn",
  CANCELED: "caution",
};

const OUTCOME_FILL: Record<TaskHistoryStatus, string> = {
  COMPLETED: "bg-signal-live",
  FAILED: "bg-signal-warn",
  CANCELED: "bg-signal-caution",
};

const OUTCOME_LABEL: Record<TaskHistoryStatus, string> = {
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const OUTCOMES: readonly TaskHistoryStatus[] = ["COMPLETED", "FAILED", "CANCELED"];

/** One headline number. PrimaryReadout's shape, as a definition pair so the row can be a <dl>. */
function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div>
      <dt className="instrument-label text-muted-foreground">{label}</dt>
      <dd className={cn("readout mt-1 text-2xl leading-none font-medium", TONE_TEXT[tone])}>
        {value}
      </dd>
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div
      className="rounded-md border border-hairline bg-panel px-4 py-3.5"
      aria-busy
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** When the backend counted, on the operator's clock once the browser has said which — the history row's trade. */
function useCountedAt(asOf: string): string {
  const timeZone = useBrowserTimeZone();
  return timeZone ? formatLocalRunTime(asOf) : `${formatUtcRunTime(asOf)} UTC`;
}

/** The hover readout for one bar: every outcome that happened, with its count. */
function barTitle(row: HistoryChartRow): string {
  return row.segments.map((s) => `${OUTCOME_LABEL[s.status]} ${s.count}`).join(" · ");
}

/**
 * How the finished jobs in the window ended: five headline numbers and one bar
 * per kind of job, each split by outcome.
 *
 * A bar's length is its kind's share of the busiest kind, so the picture reads
 * as magnitude; the split inside it is that kind's own outcomes. Totals are
 * written at the tip rather than on every segment, and the segment counts are
 * on hover and in the table a screen reader gets instead — the bar itself is
 * decoration over numbers that are all reachable without it.
 */
export function HistoryDashboard({ stats }: { stats: UseTaskHistoryStats }) {
  const headingId = React.useId();

  if (stats.status === "loading") return <LoadingDashboard />;

  if (stats.status === "error" || !stats.stats) {
    return (
      <Notice label="Counts unavailable">
        <p role="alert">{stats.error}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={stats.refresh}
        >
          Retry
        </Button>
      </Notice>
    );
  }

  return <Dashboard stats={stats.stats} headingId={headingId} />;
}

function Dashboard({
  stats,
  headingId,
}: {
  stats: NonNullable<UseTaskHistoryStats["stats"]>;
  headingId: string;
}) {
  const countedAt = useCountedAt(stats.as_of);
  const rows = chartRows(stats.by_kind);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-hairline bg-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 id={headingId} className="instrument-label text-muted-foreground">
          Over this window
        </h2>
        <span className="readout text-[11px] text-muted-foreground">
          as of {countedAt}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-5">
        <Tile label="Finished" value={formatCount(stats.total)} />
        <Tile
          label="Completed"
          value={formatCount(stats.by_status.COMPLETED)}
          tone={OUTCOME_TONE.COMPLETED}
        />
        <Tile
          label="Failed"
          value={formatCount(stats.by_status.FAILED)}
          tone={OUTCOME_TONE.FAILED}
        />
        <Tile
          label="Canceled"
          value={formatCount(stats.by_status.CANCELED)}
          tone={OUTCOME_TONE.CANCELED}
        />
        {/* An em dash, not "0 %", when nothing finished: a rate of nothing is
          * not a claim about the robot. */}
        <Tile
          label="Success rate"
          value={stats.success_rate === null ? "—" : formatPercent(stats.success_rate)}
        />
      </dl>

      {rows.length === 0 ? (
        <p className="border-t border-hairline px-4 py-3 text-[11px] leading-tight text-muted-foreground">
          No finished job in this window.
        </p>
      ) : (
        <div className="border-t border-hairline px-4 py-3.5">
          <ul aria-label="Outcome legend" className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
            {OUTCOMES.map((status) => (
              <li
                key={status}
                className="flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground"
              >
                <span
                  aria-hidden
                  className={cn("inline-block size-2 rounded-[2px]", OUTCOME_FILL[status])}
                />
                {OUTCOME_LABEL[status]}
              </li>
            ))}
          </ul>

          <ol aria-hidden className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.key}
                className="grid grid-cols-[6rem_1fr_3rem] items-center gap-3 sm:grid-cols-[9rem_1fr_3rem]"
              >
                <span className="truncate text-[12px]">{row.label}</span>
                {/* The row's track is the full column; the bar inside it is
                  * the kind's share of the busiest one. A 2 px gap between
                  * segments is what keeps two adjacent outcomes from reading
                  * as one. */}
                <span className="min-w-0">
                  <span
                    title={barTitle(row)}
                    className="flex h-4 gap-[2px] overflow-hidden rounded-[2px]"
                    style={{ width: `${row.widthPct}%` }}
                  >
                    {row.segments.map((segment) => (
                      <span
                        key={segment.status}
                        className={cn("h-full", OUTCOME_FILL[segment.status])}
                        style={{ flexBasis: `${segment.pct}%` }}
                      />
                    ))}
                  </span>
                </span>
                <span className="readout text-right text-[12px]">{formatCount(row.total)}</span>
              </li>
            ))}
          </ol>

          {/* The same numbers as a table, for whoever cannot see the bars.
            * The bars are aria-hidden above so the counts are not read twice. */}
          <table className="sr-only">
            <caption>Finished jobs by kind and outcome</caption>
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Finished</th>
                {OUTCOMES.map((status) => (
                  <th key={status} scope="col">
                    {OUTCOME_LABEL[status]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>{row.total}</td>
                  {OUTCOMES.map((status) => (
                    <td key={status}>
                      {row.segments.find((s) => s.status === status)?.count ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
