// Fold several TanStack mutations into the one `busy` / `error` pair the list
// hooks (vertices, templates, schedules) have always exposed.
//
// Those hooks own three or four writes each, and a component wired to them
// reads one flag and one sentence, not one per verb. "Most recent write
// failure" used to mean a shared `writeError` slot that every call cleared on
// entry; here it means the error of whichever mutation was submitted last,
// which is the same answer — a later write that succeeds leaves `error` null
// exactly as clearing the slot did.

import type { UseMutationResult } from "@tanstack/react-query";

/** The slice of a mutation result this reads; generic in nothing it uses. */
export type WriteMutation = Pick<
  UseMutationResult<unknown, Error, unknown, unknown>,
  "isPending" | "error" | "submittedAt"
>;

export interface WriteState {
  /** True while any of the writes is in flight. */
  busy: boolean;
  /** The last submitted write's failure, or null. Rendered verbatim. */
  error: string | null;
}

export function writeState(mutations: readonly WriteMutation[]): WriteState {
  const latest = mutations.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a));
  return {
    busy: mutations.some((mutation) => mutation.isPending),
    error: latest.error?.message ?? null,
  };
}

/**
 * Swallow a `mutateAsync` rejection: `.catch(ignore)`.
 *
 * Every command hook in this console hands its `send` / `cancel` straight to an
 * onClick or a pointer handler, so an escaping rejection would be an unhandled
 * one. The failure is not lost — it is on the mutation, which is where the UI
 * reads it from. Named rather than an inline arrow so the intent is greppable
 * and identical in all nine places.
 */
export function ignore(): void {}
