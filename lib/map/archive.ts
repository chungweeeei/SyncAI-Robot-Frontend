import { MAP_NAME_RE } from "@/lib/map/name";

/** The map archive buttons' naming rules, kept out of the fetcher (see CLAUDE.md > Layering). */

/** The archive extensions `/export` writes and `/import` sniffs. */
const ARCHIVE_SUFFIX_RE = /\.(zip|tar\.gz)$/i;

/**
 * The backend's `Content-Disposition` filename, rebuilt: CORS exposes only
 * `Location`, so the header is unreadable here. A map name never needs quoting.
 */
export function exportFilename(name: string, format: "zip" | "tar.gz" = "zip"): string {
  return `${name}.${format}`;
}

/**
 * The map name an archive's filename suggests, to pre-fill Save as, or "" if
 * it is not a valid name. Empty means the name inside the archive, always valid,
 * which beats pre-filling one the form marks invalid.
 */
export function importNameFromFilename(filename: string): string {
  const stem = filename.replace(ARCHIVE_SUFFIX_RE, "");
  return MAP_NAME_RE.test(stem) ? stem : "";
}
