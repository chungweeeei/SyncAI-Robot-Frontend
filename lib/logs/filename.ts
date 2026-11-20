import { pad2 } from "@/lib/time";

/**
 * The name a log bundle is saved as: `<robot id>-logs-<UTC stamp>.tar`, the
 * name the robot gives it (the backend's `_stamp`, `%Y%m%dT%H%M%SZ`), since
 * CORS keeps the console from reading the one it sends. Stamped with the
 * moment of the download, on this machine's clock: close to the robot's,
 * and only a name.
 *
 * "robot" before the robot has said who it is, so the file is never named
 * "-logs-…".
 */
export function logBundleFilename(robotId: string | null | undefined, nowMs: number): string {
  const at = new Date(nowMs);
  const stamp =
    `${at.getUTCFullYear()}${pad2(at.getUTCMonth() + 1)}${pad2(at.getUTCDate())}` +
    `T${pad2(at.getUTCHours())}${pad2(at.getUTCMinutes())}${pad2(at.getUTCSeconds())}Z`;
  return `${robotId || "robot"}-logs-${stamp}.tar`;
}
