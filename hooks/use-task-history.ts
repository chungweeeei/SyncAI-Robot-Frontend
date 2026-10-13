"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchTaskHistory,
  type TaskHistoryEntry,
  type TaskHistoryFilterQuery,
} from "@/lib/api/task";
import { historyQueryKey } from "@/lib/task/history";

/** Half the backend's default, so a page of expandable rows and its pager fit one screen. */
const HISTORY_PAGE_SIZE = 10;

export interface UseTaskHistory {
  /** Newest close first. */
  entries: TaskHistoryEntry[];
  /** 1-based; there is no page count (see fetchTaskHistory). */
  page: number;
  /** "loading" until this filter's first answer. */
  status: "loading" | "ok" | "error";
  /** A page change keeps the previous page on screen while the next loads. */
  switching: boolean;
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
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
 * No poll: the active-task poll invalidates `taskHistory` when a run finishes.
 */
export function useTaskHistory(filter: TaskHistoryFilterQuery): UseTaskHistory {
  const filterKey = historyQueryKey(filter);

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

  const { data, isPending, isError, error, isPlaceholderData, refetch } = useQuery({
    queryKey: queryKeys.taskHistoryPage(filterKey, pageToken),
    queryFn: ({ signal }) =>
      fetchTaskHistory(
        {
          ...filter,
          pageToken: pageToken ?? undefined,
          pageSize: HISTORY_PAGE_SIZE,
        },
        signal,
      ),
    // Only across pages of one filter, or excluded jobs would show.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === filterKey
        ? keepPreviousData(previous)
        : undefined,
  });

  const nextToken = isPlaceholderData ? null : (data?.next_page_token ?? null);

  const next = React.useCallback(() => {
    if (!nextToken) return;
    setCursor({ filterKey, tokens: [...tokens, nextToken] });
  }, [nextToken, filterKey, tokens]);

  const prev = React.useCallback(() => {
    if (tokens.length < 2) return;
    setCursor({ filterKey, tokens: tokens.slice(0, -1) });
  }, [filterKey, tokens]);

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
    refresh,
  };
}
