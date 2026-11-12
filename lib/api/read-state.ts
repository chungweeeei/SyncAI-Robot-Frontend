// The read half of mutation-state.ts: one fold from a query to the status and
// sentence a component renders, so "pending before error before ok" is
// written once rather than per hook.

import type { UseQueryResult } from "@tanstack/react-query";

import type { ReadStatus } from "@/lib/types/read";

export type ReadQuery = Pick<UseQueryResult<unknown, Error>, "isPending" | "isError" | "error">;

/**
 * Pending first: a query that has never answered is loading even while a
 * retry of it fails. An errored refetch keeps `data`, so "error" does not
 * mean there is nothing to show.
 */
export function readStatus(query: Pick<ReadQuery, "isPending" | "isError">): ReadStatus {
  return query.isPending ? "loading" : query.isError ? "error" : "ok";
}

export interface ReadState {
  status: ReadStatus;
  /** The backend's sentence for a refused read, verbatim; null otherwise. */
  error: string | null;
}

export function readState(query: ReadQuery): ReadState {
  return { status: readStatus(query), error: query.error?.message ?? null };
}
