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
  const { filter, query, statsQuery, setFilter } = useHistoryFilter();
  const stats = useTaskHistoryStats(statsQuery);
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

      <HistoryDashboard stats={stats} outcome={filter.status} />

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
      {/* Above the list: rows expand in place, so a pager below would move
        * and fall under the fold. */}
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
        <p role="alert" className="text-[11px] leading-snug text-signal-warn">
          {history.error}
        </p>
      )}
    </div>
  );
}
