// Fold a list hook's several mutations into one `busy` / `error` pair, so a
// component reads one flag and one sentence rather than one per verb. The
// error is that of the last-submitted write, so a later success clears it.

import type { UseMutationResult } from "@tanstack/react-query";

export type WriteMutation = Pick<
  UseMutationResult<unknown, Error, unknown, unknown>,
  "isPending" | "error" | "submittedAt"
>;

export interface WriteState {
  busy: boolean;
  /** The last submitted write's failure, or null. Rendered verbatim. */
  error: string | null;
  /** The same failure as thrown, for a caller that reads a typed error's fields. */
  failure: Error | null;
}

export function writeState(mutations: readonly WriteMutation[]): WriteState {
  const latest = mutations.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
  return {
    busy: mutations.some((mutation) => mutation.isPending),
    error: latest.error?.message ?? null,
    failure: latest.error ?? null,
  };
}

/**
 * `.catch(ignore)` for a `mutateAsync` wired straight to a handler, where an
 * escaping rejection would be unhandled. The failure is not lost: the UI reads
 * it off the mutation.
 */
export function ignore(): void {}
