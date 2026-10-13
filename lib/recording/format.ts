// A recording's four numbers, shared by the recorder and the list so one
// quantity never has two spellings on a screen.

/** `4:12`, or `1:04:12` once a run passes the hour. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);

  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * B / KiB / MiB / GiB. Tiered, unlike a map's size: a recording spans KB to
 * GB, and a fixed MiB would read `0 MiB` just as the operator checks it started.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(0)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}

/**
 * `2026-09-18 09:22`, sliced from the ISO string rather than toLocaleString:
 * the page is prerendered, so a server/browser timezone difference would be a
 * hydration mismatch. UTC matches the recording's own timestamps.
 */
export function formatTimestamp(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * `1 585` — thin spaces every three digits. Not `Intl.NumberFormat`: its
 * locale-dependent grouping is the same prerender hazard.
 */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
