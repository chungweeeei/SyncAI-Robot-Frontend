import type { WifiConnection } from "@/lib/api/network";
import type { RobotNetworkStatus } from "@/lib/types/robot";

/**
 * Blanks in the shape of the value they stand in for, so a card off the
 * network reads as "no address" rather than as a readout that failed.
 */
export const RSSI_BLANK = "-- dBm";
export const IP_BLANK = "--.--.--.--";
export const MAC_BLANK = "--:--:--:--:--:--";

/** What a saved network's card reads out of the robot's link; null is a blank. */
export interface LinkReadout {
  /** dBm. */
  rssi: number | null;
  ip: string | null;
  mac: string | null;
}

/**
 * The state poll's link readings for the card whose SSID it reports, nothing
 * for the rest. Matched on the poll, never the list's `active`, which goes
 * stale when the robot roams. An empty address (DHCP pending) is nothing too.
 */
export function linkReadout(
  ssid: string,
  current: RobotNetworkStatus | null,
): LinkReadout {
  const on = current && current.ssid !== "" && current.ssid === ssid ? current : null;
  return {
    rssi: on?.rssi ?? null,
    ip: on?.ip_address || null,
    mac: on?.mac_address || null,
  };
}

/**
 * Saved networks in page order: the live one, then most recently joined, then
 * never-joined by name (so the grid does not reshuffle between reads).
 *
 * `currentSsid` (the 1 Hz state poll) wins over the list's `active`, which is
 * only re-read after a write.
 */
export function orderConnections(
  connections: readonly WifiConnection[],
  currentSsid: string | null,
): WifiConnection[] {
  const live = (c: WifiConnection) =>
    currentSsid === null ? c.active : c.ssid === currentSsid;
  const used = (c: WifiConnection) =>
    c.last_used_at === null ? -Infinity : Date.parse(c.last_used_at);
  return [...connections].sort((a, b) => {
    const byLive = Number(live(b)) - Number(live(a));
    if (byLive !== 0) return byLive;
    const byUse = used(b) - used(a);
    if (byUse !== 0 && !Number.isNaN(byUse)) return byUse;
    return a.ssid.localeCompare(b.ssid);
  });
}

/**
 * A card's "Last joined …" line: relative within a week, a date after. `now`
 * is the list's read time, so a render never reads Date.now().
 */
export function lastUsedLabel(lastUsedAt: string | null, now: number): string {
  if (lastUsedAt === null) return "Never joined";
  const at = Date.parse(lastUsedAt);
  if (Number.isNaN(at)) return "Never joined";
  return `Last joined ${since(now - at, at)}`;
}

function since(elapsedMs: number, at: number): string {
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
