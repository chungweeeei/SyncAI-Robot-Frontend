"use client";

import * as React from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchTaskHistory,
  type TaskHistoryEntry,
  type TaskHistoryFilterQuery,
} from "@/lib/api/task";
import { historyQueryKey, type HistoryPageSize } from "@/lib/task/history";
import type { ReadStatus } from "@/lib/types/read";

export interface UseTaskHistory {
  /** Newest close first. */
  entries: TaskHistoryEntry[];
  /** 1-based; there is no page count (see fetchTaskHistory). */
  page: number;
  /** "loading" until this filter's first answer. */
  status: ReadStatus;
  /** A page change keeps the previous page on screen while the next loads. */
  switching: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  /** Back to the newest page, whose cursor is always known. */
  first: () => void;
  refresh: () => void;
}

/**
 * Finished jobs on this robot, one page at a time.
 *
 * The backend only pages forward, so `tokens[i]` is the cursor for page i + 1
 * and going back re-reads an earlier one, usually from cache. A cursor is only
 * valid under the filter it was issued with, so a new filter starts over at
 * page one — which is why the caller must hold the window's `since` still
 * across page turns (see useHistoryFilter).
 *
 * The page size is part of the cursor's key for the same reason: a cursor
 * marks a row count, so a new size starts over too.
 *
 * The next page is prefetched once its cursor arrives, so Next answers at
 * once; one extra read per page turned, never a poll.
 *
 * No poll: the active-task poll invalidates `taskHistory` when a run finishes.
 */
export function useTaskHistory(
  filter: TaskHistoryFilterQuery,
  pageSize: HistoryPageSize,
): UseTaskHistory {
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify([historyQueryKey(filter), pageSize]);

  const [cursor, setCursor] = React.useState<{
    filterKey: string;
    tokens: (string | null)[];
  }>({ filterKey, tokens: [null] });

  // Derived, not reset in an effect, so the first render after a filter change
  // never sends a foreign cursor.
  const tokens = React.useMemo(
    () => (cursor.filterKey === filterKey ? cursor.tokens : [null]),
    [cursor, filterKey],
  );
  const pageToken = tokens[tokens.length - 1];

  const pageQuery = React.useCallback(
    (token: string | null) => ({
      queryKey: queryKeys.taskHistoryPage(filterKey, token),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchTaskHistory({ ...filter, pageToken: token ?? undefined, pageSize }, signal),
    }),
    [filter, filterKey, pageSize],
  );

  const { data, isPending, isError, error, isPlaceholderData, refetch } = useQuery({
    ...pageQuery(pageToken),
    // Only across pages of one filter, or excluded jobs would show.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filterKey
        ? keepPreviousData(previous)
        : undefined,
  });

  const nextToken = isPlaceholderData ? null : (data?.next_page_token ?? null);

  React.useEffect(() => {
    if (nextToken) void queryClient.prefetchQuery(pageQuery(nextToken));
  }, [nextToken, pageQuery, queryClient]);

  const next = React.useCallback(() => {
    if (!nextToken) return;
    setCursor({ filterKey, tokens: [...tokens, nextToken] });
  }, [nextToken, filterKey, tokens]);

  const prev = React.useCallback(() => {
    if (tokens.length < 2) return;
    setCursor({ filterKey, tokens: tokens.slice(0, -1) });
  }, [filterKey, tokens]);

  const first = React.useCallback(() => {
    setCursor({ filterKey, tokens: [null] });
  }, [filterKey]);

  const refresh = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    entries: data?.tasks ?? [],
    page: tokens.length,
    status: data ? "ok" : isPending ? "loading" : "error",
    switching: isPlaceholderData,
    error: isError ? error.message : null,
    hasNext: nextToken !== null,
    hasPrev: tokens.length > 1,
    next,
    prev,
    first,
    refresh,
  };
}
