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
import {
  formatPercent,
  outcomeSegments,
  type HistoryStatusFilter,
} from "@/lib/task/history";
import { formatLocalRunTime, formatUtcRunTime } from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/**
 * The hue each outcome's chip wears on the rows below, so a bar segment and
 * the chips it counts are one colour.
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
      <dd className={cn("readout mt-1.5 text-2xl leading-none font-medium", TONE_TEXT[tone])}>
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

/** When the backend counted, on the operator's clock once the browser has said which. */
function useCountedAt(asOf: string): string {
  const timeZone = useBrowserTimeZone();
  return timeZone ? formatLocalRunTime(asOf) : `${formatUtcRunTime(asOf)} UTC`;
}

export interface HistoryDashboardProps {
  stats: UseTaskHistoryStats;
  /** The outcome the list below is narrowed to, so the dashboard can say so. */
  outcome: HistoryStatusFilter;
}

/**
 * How the finished jobs in the window ended: five headline numbers and one
 * bar split by outcome. Display only.
 *
 * The counts ignore the outcome filter (see toHistoryStatsQuery), so the
 * dashboard is the window's whole picture whichever outcome is listed; the
 * caption says when one is. The bar is the tiles as proportion, so it needs
 * no table alternative.
 */
export function HistoryDashboard({ stats, outcome }: HistoryDashboardProps) {
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

  return <Dashboard stats={stats.stats} headingId={headingId} outcome={outcome} />;
}

function Dashboard({
  stats,
  headingId,
  outcome,
}: {
  stats: NonNullable<UseTaskHistoryStats["stats"]>;
  headingId: string;
  outcome: HistoryStatusFilter;
}) {
  const countedAt = useCountedAt(stats.as_of);
  const segments = outcomeSegments(stats);
  const barTitle = OUTCOMES.map(
    (status) => `${OUTCOME_LABEL[status]} ${stats.by_status[status]}`,
  ).join(" · ");

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

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 pt-3.5 pb-3 sm:grid-cols-5">
        <Tile label="Finished" value={formatCount(stats.total)} />
        {OUTCOMES.map((status) => (
          <Tile
            key={status}
            label={OUTCOME_LABEL[status]}
            value={formatCount(stats.by_status[status])}
            tone={OUTCOME_TONE[status]}
          />
        ))}
        {/* An em dash, not "0 %", when nothing finished. */}
        <Tile
          label="Success rate"
          value={stats.success_rate === null ? "—" : formatPercent(stats.success_rate)}
        />
      </dl>

      {outcome !== "ALL" && (
        <p className="px-4 pb-3 text-[11px] leading-tight text-muted-foreground">
          {`Only ${OUTCOME_LABEL[outcome].toLowerCase()} jobs are listed below; the counts are the whole window's.`}
        </p>
      )}

      <div className="border-t border-hairline px-4 py-3.5">
        {segments.length === 0 ? (
          <p className="text-[11px] leading-tight text-muted-foreground">
            No finished job in this window.
          </p>
        ) : (
          <>
            {/* A 2 px gap keeps adjacent outcomes apart; a count sits in a
              * segment only when it fits — the tooltip and tiles carry the rest. */}
            <div
              title={barTitle}
              aria-hidden
              className="flex h-5 gap-[2px] overflow-hidden rounded-[2px]"
            >
              {segments.map((segment) => (
                <span
                  key={segment.status}
                  className={cn(
                    "readout flex h-full items-center justify-center text-[11px] font-medium text-background",
                    OUTCOME_FILL[segment.status],
                  )}
                  style={{ flexBasis: `${segment.pct}%` }}
                >
                  {segment.pct >= 8 && formatCount(segment.count)}
                </span>
              ))}
            </div>
            <ul aria-label="Outcome legend" className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
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
          </>
        )}
      </div>
    </section>
  );
}
