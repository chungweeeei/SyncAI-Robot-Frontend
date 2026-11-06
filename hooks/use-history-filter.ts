"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { TaskHistoryFilterQuery } from "@/lib/api/task";
import {
  historySearch,
  parseHistoryFilter,
  parseHistoryPageSize,
  toHistoryQuery,
  toHistoryStatsQuery,
  type HistoryFilter,
  type HistoryPageSize,
} from "@/lib/task/history";

export interface UseHistoryFilter {
  /** The address bar's reading. */
  filter: HistoryFilter;
  /** The list's wire filter: the preset resolved to a `since` at the last set. */
  query: TaskHistoryFilterQuery;
  /** The dashboard's wire filter: the same window, never the outcome. */
  statsQuery: TaskHistoryFilterQuery;
  setFilter: (next: HistoryFilter) => void;
  /** Rows a page asks for; kept in the address beside the filter. */
  pageSize: HistoryPageSize;
  setPageSize: (next: HistoryPageSize) => void;
}

/**
 * The history screen's filter, kept in `/history?…` so a view can be
 * bookmarked or shared, and read back through the same codec.
 *
 * Written with `history.replaceState`, which the App Router folds into
 * `useSearchParams`. Not `router.replace`: that navigates, and against a
 * prefetched route it was seen to leave the address untouched. Replace, not
 * push, so Back does not walk through every refinement.
 *
 * The window is anchored once per gesture, never from the clock in render: the
 * page re-renders at 1 Hz, and a moving `since` would be a new key (and page
 * one) every second. Back / Forward keeps the older anchor, so the window is
 * slightly wider, never narrower.
 */
export function useHistoryFilter(): UseHistoryFilter {
  const pathname = usePathname();
  const search = useSearchParams();

  const { filter, pageSize } = React.useMemo(() => {
    const params = new URLSearchParams(search.toString());
    return { filter: parseHistoryFilter(params), pageSize: parseHistoryPageSize(params) };
  }, [search]);

  const [anchorMs, setAnchorMs] = React.useState(() => Date.now());

  // A new page size starts over at page one, so it re-anchors like a filter.
  const write = React.useCallback(
    (nextFilter: HistoryFilter, nextSize: HistoryPageSize) => {
      setAnchorMs(Date.now());
      const params = historySearch(nextFilter, nextSize);
      window.history.replaceState(null, "", params ? `${pathname}?${params}` : pathname);
    },
    [pathname],
  );

  const setFilter = React.useCallback(
    (next: HistoryFilter) => write(next, pageSize),
    [write, pageSize],
  );
  const setPageSize = React.useCallback(
    (next: HistoryPageSize) => write(filter, next),
    [write, filter],
  );

  const query = React.useMemo(() => toHistoryQuery(filter, anchorMs), [filter, anchorMs]);
  const statsQuery = React.useMemo(
    () => toHistoryStatsQuery(filter, anchorMs),
    [filter, anchorMs],
  );

  return { filter, query, statsQuery, setFilter, pageSize, setPageSize };
}
