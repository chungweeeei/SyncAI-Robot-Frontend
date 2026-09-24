"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchTaskHistory,
  type TaskHistoryEntry,
  type TaskHistoryStatus,
} from "@/lib/api/task";

/**
 * Rows per page. Half the backend's default of 20: with the rows expandable, ten
 * keeps a page — and the pager under it — on one screen.
 */
const HISTORY_PAGE_SIZE = 10;

export interface UseTaskHistory {
  /** This page's jobs, in the backend's order: newest close first. */
  entries: TaskHistoryEntry[];
  /** 1-based. There is no page count to go with it; see fetchTaskHistory. */
  page: number;
  /**
   * "loading" until this filter's first answer. A page change keeps the
   * previous page on screen while the next one loads (`switching`), so paging
   * does not flash the skeleton.
   */
  status: "loading" | "ok" | "error";
  switching: boolean;
  /** The backend's sentence for a failed read, verbatim. */
  error: string | null;
  hasNext: boolean;
  hasPrev: boolean;
  next: () => void;
  prev: () => void;
  refresh: () => void;
}

/**
 * Finished jobs on this robot, one page at a time, with Previous and Next.
 *
 * The backend only pages forward, so going back is done here: `tokens[i]` is
 * the cursor that reaches page i + 1, and stepping back is reading an earlier
 * cursor again — usually straight from the cache. The stack belongs to one
 * filter, and a different filter starts a fresh one at page one, because the
 * backend's cursor is only valid under the filter it was issued with.
 *
 * No poll. The list only changes when a run finishes, and the one place in the
 * console that sees every run finish — whoever started it — is the active-task
 * poll, which invalidates `queryKeys.taskHistory` when an id drops out of it
 * (see useActiveTasks). Polling here as well would spend a request every few
 * seconds to learn what that poll already knows.
 */
export function useTaskHistory(status: TaskHistoryStatus | null): UseTaskHistory {
  const [cursor, setCursor] = React.useState<{
    status: TaskHistoryStatus | null;
    tokens: (string | null)[];
  }>({ status, tokens: [null] });

  // Derived rather than reset in an effect: a stack left over from another
  // filter is simply not this filter's, so the first render after a change
  // already asks for page one instead of sending a foreign cursor.
  const tokens = React.useMemo(
    () => (cursor.status === status ? cursor.tokens : [null]),
    [cursor, status],
  );
  const pageToken = tokens[tokens.length - 1];

  const { data, isPending, isError, error, isPlaceholderData, refetch } = useQuery({
    queryKey: queryKeys.taskHistoryPage(status, pageToken),
    queryFn: ({ signal }) =>
      fetchTaskHistory(
        {
          status: status ?? undefined,
          pageToken: pageToken ?? undefined,
          pageSize: HISTORY_PAGE_SIZE,
        },
        signal,
      ),
    // Only across pages of the same filter. Holding another filter's rows on
    // screen under a new filter would show jobs the filter excludes.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === (status ?? "all")
        ? keepPreviousData(previous)
        : undefined,
  });

  const nextToken = isPlaceholderData ? null : (data?.next_page_token ?? null);

  const next = React.useCallback(() => {
    if (!nextToken) return;
    setCursor({ status, tokens: [...tokens, nextToken] });
  }, [nextToken, status, tokens]);

  const prev = React.useCallback(() => {
    if (tokens.length < 2) return;
    setCursor({ status, tokens: tokens.slice(0, -1) });
  }, [status, tokens]);

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
