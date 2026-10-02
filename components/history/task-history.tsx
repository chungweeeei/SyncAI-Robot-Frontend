"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { HistoryDashboard } from "@/components/history/history-dashboard";
import { HistoryFilters } from "@/components/history/history-filters";
import { HistoryRow } from "@/components/history/history-row";
import { Notice } from "@/components/history/notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useHistoryFilter } from "@/hooks/use-history-filter";
import { useSchedules } from "@/hooks/use-schedules";
import { useTaskHistory, type UseTaskHistory } from "@/hooks/use-task-history";
import { useTaskHistoryStats } from "@/hooks/use-task-history-stats";
import { useTaskTemplates } from "@/hooks/use-task-templates";
import { DEFAULT_HISTORY_FILTER, historyNameOptions } from "@/lib/task/history";
import { cn } from "@/lib/utils";

function LoadingList() {
  return (
    <div
      className="divide-y divide-hairline rounded-md border border-hairline bg-panel"
      aria-busy
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-40" />
        </div>
      ))}
    </div>
  );
}

/**
 * Finished jobs on this robot: how the ones in the window ended, counted, and
 * then listed newest first.
 *
 * One filter row scopes both. The counts and the list are read under the
 * same wire filter, from the same anchored window, which is the only way the
 * numbers above can be true of the rows below. The window is the first
 * control because, now that the robot keeps jobs for longer than a day, it
 * is the one every reader reaches for.
 *
 * The Name picker's choices come from the template library and the schedule
 * list — the two places a name can be given to a job — which means this
 * screen mounts useSchedules and its one derived refetch at the next run;
 * that is the hook's normal cost and no more than /tasks pays.
 */
export function TaskHistory() {
  const { filter, query, setFilter } = useHistoryFilter();
  const stats = useTaskHistoryStats(query);
  const history = useTaskHistory(query);
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

      <HistoryDashboard stats={stats} />

      <HistoryList
        history={history}
        narrowed={narrowed}
        clear={() => setFilter(DEFAULT_HISTORY_FILTER)}
      />
    </div>
  );
}

function HistoryList({
  history,
  narrowed,
  clear,
}: {
  history: UseTaskHistory;
  /** True when something besides the window narrows the list. */
  narrowed: boolean;
  clear: () => void;
}) {
  if (history.status === "loading") return <LoadingList />;

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

  return (
    <div className="space-y-3">
      {/* Above the list, not under it: a row opens into its steps in place, so
        * a pager at the bottom moves every time one is opened, and on a full
        * page it sits below the fold. No pager at all for a history that fits
        * on one page. */}
      {(history.hasPrev || history.hasNext) && (
        <nav aria-label="History pages" className="flex items-center justify-end gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!history.hasPrev || history.switching}
            onClick={history.prev}
          >
            <ChevronLeftIcon aria-hidden />
            Previous
          </Button>
          <span className="readout text-[12px] text-muted-foreground" aria-live="polite">
            Page {history.page}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!history.hasNext || history.switching}
            onClick={history.next}
          >
            Next
            <ChevronRightIcon aria-hidden />
          </Button>
        </nav>
      )}

      {/* A last page can come back empty when the one before it ended exactly
        * on a page boundary; the backend only knows there is nothing left once
        * it has looked. */}
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
          // The previous page stays up while the next one loads; dimmed, so it
          // does not read as the answer.
          history.switching && "opacity-60",
        )}
      >
        {history.entries.map((entry) => (
          // run_id, not id: the backend guarantees nothing about a workflow id
          // being used once, and a run id is unique by construction.
          <HistoryRow key={entry.run_id} entry={entry} />
        ))}
      </ul>

      {history.error && (
        <p role="alert" className="text-[11px] leading-snug text-signal-warn">
          {history.error}
        </p>
      )}
    </div>
  );
}
