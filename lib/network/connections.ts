import type { WifiConnection } from "@/lib/api/network";
import type { RobotNetworkStatus } from "@/lib/types/robot";

/**
 * What a card shows in place of a value it has no reading for. Each blank is
 * in the shape of the value it stands in for, so a card off the network reads
 * as "no address" at a glance rather than as a readout that failed to render.
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
 * The state poll's signal and addresses for the card whose SSID the poll
 * reports, and nothing for every other card. Matched on the poll alone, never
 * on the list's `active`: a card the list still flags after the robot roamed
 * must not show the new network's address as its own. An address the poll
 * reports empty (still waiting on DHCP) is nothing too.
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
 * The order the Wi-Fi page lays its saved networks out in: the one the robot
 * is on first, then the most recently joined, and the never-joined last (in
 * name order, so the grid does not reshuffle between two reads).
 *
 * `currentSsid` is the state poll's reading and wins over the list's own
 * `active`: the poll is 1 Hz and the list is only read again after a write, so
 * after the robot roams by itself the list's flag is the stale one of the two.
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
 * When the robot last joined a saved network, as the line a card shows: a
 * relative phrase for the last week, a date after that, and its own sentence
 * for a network saved but never brought up. `now` is the list's read time,
 * not the clock, so a render never reads Date.now().
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
