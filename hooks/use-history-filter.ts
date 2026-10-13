"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { TaskHistoryFilterQuery } from "@/lib/api/task";
import {
  parseHistoryFilter,
  serializeHistoryFilter,
  toHistoryQuery,
  toHistoryStatsQuery,
  type HistoryFilter,
} from "@/lib/task/history";

export interface UseHistoryFilter {
  /** The address bar's reading. */
  filter: HistoryFilter;
  /** The list's wire filter: the preset resolved to a `since` at the last set. */
  query: TaskHistoryFilterQuery;
  /** The dashboard's wire filter: the same window, never the outcome. */
  statsQuery: TaskHistoryFilterQuery;
  setFilter: (next: HistoryFilter) => void;
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

  const filter = React.useMemo(
    () => parseHistoryFilter(new URLSearchParams(search.toString())),
    [search],
  );

  const [anchorMs, setAnchorMs] = React.useState(() => Date.now());

  const setFilter = React.useCallback(
    (next: HistoryFilter) => {
      setAnchorMs(Date.now());
      const params = serializeHistoryFilter(next).toString();
      window.history.replaceState(null, "", params ? `${pathname}?${params}` : pathname);
    },
    [pathname],
  );

  const query = React.useMemo(() => toHistoryQuery(filter, anchorMs), [filter, anchorMs]);
  const statsQuery = React.useMemo(
    () => toHistoryStatsQuery(filter, anchorMs),
    [filter, anchorMs],
  );

  return { filter, query, statsQuery, setFilter };
}
