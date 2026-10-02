"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

import type { TaskHistoryFilterQuery } from "@/lib/api/task";
import {
  parseHistoryFilter,
  serializeHistoryFilter,
  toHistoryQuery,
  type HistoryFilter,
} from "@/lib/task/history";

export interface UseHistoryFilter {
  /** The filter as the operator set it — the address bar's reading. */
  filter: HistoryFilter;
  /**
   * The wire filter both history reads take: the same filter with its preset
   * resolved to a `since`, against an anchor taken when the filter was last
   * set rather than at every render.
   */
  query: TaskHistoryFilterQuery;
  setFilter: (next: HistoryFilter) => void;
}

/**
 * The history screen's filter, kept in `/history?…` so a view can be
 * bookmarked, reloaded or sent to someone — and read back through the same
 * codec, so what the address says and what the screen shows are one thing.
 *
 * Written with the browser's own `history.replaceState`, which the App Router
 * folds into `useSearchParams` (see the "Native History API" section of its
 * linking docs). Not `router.replace`: that is a navigation, which fetches
 * the route again and — for a target the nav rail had already prefetched —
 * was observed to leave the address untouched, so clearing the filters did
 * nothing. A search-param change on the screen the operator is already on is
 * not a navigation. Replace, not push: each segment pressed is a refinement
 * of one screen, and a Back that walked through ten of them before leaving
 * would be a trap.
 *
 * The window is anchored in state, once per gesture, and never computed from
 * the clock in render. This page re-renders at 1 Hz with the robot-state poll
 * it shows the robot id from, and a `since` that moved with it would be a new
 * query key every second — restarting the list at page one under a cursor the
 * backend issued for the old window, and re-counting the dashboard for
 * nothing. Browser Back / Forward changes the address without re-anchoring,
 * so a preset reached that way is read against the older anchor: slightly
 * wider than "the last six hours" and never narrower, which is the right way
 * round for a window that exists to show jobs.
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

  return { filter, query, setFilter };
}
