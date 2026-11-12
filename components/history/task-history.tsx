"use client";

import * as React from "react";

import { ErrorLine } from "@/components/console/error-line";
import { HistoryDashboard } from "@/components/history/history-dashboard";
import { HistoryFilters } from "@/components/history/history-filters";
import { HistoryPager } from "@/components/history/history-pager";
import { HistoryRow } from "@/components/history/history-row";
import { LoadingList, Notice } from "@/components/console/notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useHistoryFilter } from "@/hooks/use-history-filter";
import { useSchedules } from "@/hooks/use-schedules";
import { useTaskHistory, type UseTaskHistory } from "@/hooks/use-task-history";
import { useTaskHistoryStats, type UseTaskHistoryStats } from "@/hooks/use-task-history-stats";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import {
  DEFAULT_HISTORY_FILTER,
  historyNameOptions,
  historyPageWindow,
  matchingTotal,
  type HistoryPageSize,
  type HistoryStatusFilter,
} from "@/lib/task/history";
import { cn } from "@/lib/utils";

/**
 * Finished jobs on this robot: counted, then listed newest first.
 *
 * One toolbar scopes both from the same anchored window, so the numbers are
 * true of the rows. The outcome narrows only the list, so the dashboard stays
 * how the window's jobs ended rather than a tautology.
 *
 * The Name picker draws on the template library and the schedule list, so
 * this screen mounts useSchedules — no more than /tasks pays.
 */
export function TaskHistory() {
  const { filter, query, statsQuery, setFilter, pageSize, setPageSize } = useHistoryFilter();
  const stats = useTaskHistoryStats(statsQuery);
  const history = useTaskHistory(query, pageSize);
  const { templates } = useTaskTemplates();
  const { schedules } = useSchedules();
  const timeZone = useBrowserTimeZone();

  const names = React.useMemo(
    () =>
      historyNameOptions(
        templates.map((template) => template.name),
        schedules.map((schedule) => schedule.task_template_name),
        filter.name,
      ),
    [templates, schedules, filter.name],
  );

  const narrowed =
    filter.status !== "ALL" || filter.kind !== null || filter.name !== null;

  return (
    <div className="space-y-3">
      <HistoryFilters
        filter={filter}
        onChange={setFilter}
        names={names}
        timeZone={timeZone}
      />

      <HistoryDashboard stats={stats} outcome={filter.status} />

      <HistoryList
        history={history}
        stats={stats}
        status={filter.status}
        pageSize={pageSize}
        onPageSize={setPageSize}
        narrowed={narrowed}
        clear={() => setFilter(DEFAULT_HISTORY_FILTER)}
      />
    </div>
  );
}

function HistoryList({
  history,
  stats,
  status,
  pageSize,
  onPageSize,
  narrowed,
  clear,
}: {
  history: UseTaskHistory;
  /** The dashboard's counts, which give the pager its total. */
  stats: UseTaskHistoryStats;
  status: HistoryStatusFilter;
  pageSize: HistoryPageSize;
  onPageSize: (next: HistoryPageSize) => void;
  /** True when something besides the window narrows the list. */
  narrowed: boolean;
  clear: () => void;
}) {
  if (history.status === "loading") {
    return (
      <LoadingList rowClassName="flex items-center gap-3">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-4 w-40" />
      </LoadingList>
    );
  }

  if (history.status === "error") {
    return (
      <Notice label="History unavailable">
        <p role="alert">{history.error}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={history.refresh}
        >
          Retry
        </Button>
      </Notice>
    );
  }

  if (!history.entries.length && history.page === 1) {
    return (
      <Notice label="No jobs">
        {narrowed ? (
          <>
            <p>No finished job on this robot matches these filters.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={clear}
            >
              Clear filters
            </Button>
          </>
        ) : (
          "No finished job in this window. Jobs appear here once they end."
        )}
      </Notice>
    );
  }

  const span = historyPageWindow({
    page: history.page,
    pageSize,
    shown: history.entries.length,
    total: matchingTotal(stats.stats, status),
    hasNext: history.hasNext,
  });

  return (
    <div className="space-y-3">
      <HistoryPager history={history} span={span} pageSize={pageSize} onPageSize={onPageSize} />

      {/* A last page can be empty when the one before ended on a page
        * boundary; the backend only knows once it has looked. */}
      {!history.entries.length && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          No more jobs.
        </p>
      )}

      <ul
        hidden={!history.entries.length}
        aria-busy={history.switching || undefined}
        className={cn(
          "divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-panel transition-opacity",
          // The previous page stays up, dimmed, while the next one loads.
          history.switching && "opacity-60",
        )}
      >
        {history.entries.map((entry) => (
          // run_id, not id: a workflow id may be reused, a run id is unique.
          <HistoryRow key={entry.run_id} entry={entry} />
        ))}
      </ul>

      {history.error && (
        <ErrorLine>
          {history.error}
        </ErrorLine>
      )}
    </div>
  );
}
