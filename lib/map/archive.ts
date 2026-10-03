import { MAP_NAME_RE } from "@/lib/map/name";

/**
 * The two rules the map archive buttons need and the fetcher should not own:
 * what the exported file is called, and what an archive picked for import
 * suggests the map should be called. Beside lib/map/name.ts for the reason
 * that file gives — a control importing a fetcher module to reach a string
 * rule is the layering break CLAUDE.md names.
 */

/** The archive extensions `/export` writes and `/import` sniffs. */
const ARCHIVE_SUFFIX_RE = /\.(zip|tar\.gz)$/i;

/**
 * The filename the backend puts in `Content-Disposition`, rebuilt here.
 *
 * The console is cross-origin to the backend and its CORS policy exposes only
 * `Location`, so the header is unreadable from the browser even though it is
 * sent. The rule is simple enough to mirror: `<name>.<format>`, and a map name
 * admits only `[A-Za-z0-9._-]` so it never needs quoting.
 */
export function exportFilename(name: string, format: "zip" | "tar.gz" = "zip"): string {
  return `${name}.${format}`;
}

/**
 * The map name an archive's filename suggests, or "" when it suggests none.
 *
 * An export is named after its map, so an archive that comes straight back is
 * best imported under the name on the file, and that is what the Save-as field
 * is pre-filled with. A file someone renamed to "office (copy).zip" suggests
 * nothing the catalogue would accept, and pre-filling the field with a name
 * the form immediately marks invalid is worse than leaving it empty: empty
 * means "the name written inside the archive", which is always a valid one.
 */
export function importNameFromFilename(filename: string): string {
  const stem = filename.replace(ARCHIVE_SUFFIX_RE, "");
  return MAP_NAME_RE.test(stem) ? stem : "";
}
