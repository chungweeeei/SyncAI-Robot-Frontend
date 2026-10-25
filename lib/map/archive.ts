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

/**
 * The largest archive the robot takes (`MAP_IMPORT_MAX_BYTES` in the backend's
 * maps router): a map export is a few hundred MB, so anything past this is the
 * wrong file. Mirrored so the console refuses before a minutes-long upload the
 * robot would only refuse with 413 `archive_too_large` — and the refusal may
 * not even arrive as one, since the robot answers before reading the body and
 * a browser still sending can see that as a dropped connection instead.
 */
export const MAP_IMPORT_MAX_BYTES = 4 * 1024 ** 3;

/**
 * Why an archive of `bytes` cannot be imported, in the backend's own words for
 * its 413, or null when its size is fine.
 */
export function importSizeProblem(bytes: number): string | null {
  return bytes > MAP_IMPORT_MAX_BYTES
    ? `The archive is larger than ${MAP_IMPORT_MAX_BYTES / 1024 ** 3} GiB; a map ` +
        "export is far smaller. Is this the right file?"
    : null;
}
