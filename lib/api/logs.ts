import { apiUrl } from "@/lib/api/config";
import { readBlob, requestRaw } from "@/lib/api/http";

/**
 * GET /api/v1/logs/export: the robot's last 24 h of logs as one tar, for an
 * engineer to read. No parameters; the window is the backend's.
 *
 * Always 200 when the robot answers at all: a source it cannot read is left
 * out and named in the bundle's own manifest, not refused. The robot builds
 * the whole bundle before the first byte (a day of the host's log can take
 * it a couple of minutes), then streams it with its `Content-Length`, so
 * `onProgress` (a fraction, 0–1) covers the transfer only.
 *
 * The file is named by the caller (lib/logs/filename.ts): CORS exposes only
 * `Location`, so the server's `Content-Disposition` reads null here.
 */
export async function exportLogs(onProgress?: (fraction: number) => void): Promise<Blob> {
  const res = await requestRaw(apiUrl("/api/v1/logs/export"));
  return readBlob(res, onProgress);
}
