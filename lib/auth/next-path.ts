/**
 * Where the sign-in screen sends the operator once signed in: the screen the
 * console turned them away from, carried in `?next=`.
 *
 * Only a path on this console: `//host` and `/\host` are another origin to a
 * browser, and a `next` that pointed off-site would make the sign-in screen
 * a redirect anyone could link. /login itself would be a loop.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return "/";
  return raw;
}

/** The sign-in screen's address, remembering `from` when it is not the dashboard. */
export function loginHref(from: string): string {
  const next = safeNextPath(from);
  return next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
