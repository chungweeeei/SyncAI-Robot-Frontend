"use client";

import * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { HistoryRow } from "@/components/history/history-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskHistory, type UseTaskHistory } from "@/hooks/use-task-history";
import type { TaskHistoryStatus } from "@/lib/api/task";
import { cn } from "@/lib/utils";

type StatusFilter = TaskHistoryStatus | "ALL";

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELED", label: "Canceled" },
];

/** Same panel shape /recordings and /maps use when there is nothing to list. */
function Notice({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline bg-panel p-4">
      <p className="instrument-label text-muted-foreground">{label}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

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
 * Finished jobs on this robot, newest first, filtered by how they ended.
 *
 * One filter, on purpose. There used to be a time range beside it, but the
 * robot keeps finished jobs for about a day, so "last 24 hours" and "all" were
 * the same list and the control was only something to read past.
 */
export function TaskHistory() {
  const [status, setStatus] = React.useState<StatusFilter>("ALL");
  const history = useTaskHistory(status === "ALL" ? null : status);

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Outcome">
        <Segmented value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      </div>

      <HistoryList history={history} filtered={status !== "ALL"} />
    </div>
  );
}

function HistoryList({
  history,
  filtered,
}: {
  history: UseTaskHistory;
  filtered: boolean;
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
        {filtered
          ? "No finished job on this robot ended this way."
          : "No finished job is kept on this robot. Jobs appear here once they end."}
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
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

      {/* No pager at all for a history that fits on one page. */}
      {(history.hasPrev || history.hasNext) && (
        <nav aria-label="History pages" className="flex items-center justify-center gap-3">
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
    </div>
  );
}
