// The job history screen's arithmetic. React-free so the rule can be tested
// without a page, and kept apart from lib/api/task.ts because it is not a
// request.

/**
 * Seconds between a run's start and its close, both server timestamps, or null
 * when the close time is missing.
 *
 * Null rather than 0: zero seconds is a claim about the run, and a row with no
 * close time has made no such claim. A negative span (clock skew inside the
 * backend) clamps to zero instead of rendering as a minus sign.
 */
export function runSeconds(
  startedAt: string,
  closedAt: string | null,
): number | null {
  if (closedAt === null) return null;
  const start = Date.parse(startedAt);
  const close = Date.parse(closedAt);
  if (Number.isNaN(start) || Number.isNaN(close)) return null;
  return Math.max(0, Math.floor((close - start) / 1000));
}
