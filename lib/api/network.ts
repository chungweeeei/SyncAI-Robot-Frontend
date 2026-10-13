import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

export interface WifiNetwork {
  /** Access-point MAC; the strongest AP when several serve one SSID. */
  bssid: string;
  ssid: string;
  /** dBm, folded from nmcli's 0–100 as ceil(s/2 − 100). */
  rssi: number;
}

const WifiNetworkSchema: z.ZodType<WifiNetwork> = z.object({
  bssid: z.string(),
  ssid: z.string(),
  rssi: z.number(),
});

/**
 * Scan for networks visible to the robot. Slow (a rescan of up to 10 s; the
 * gateway waits 45 s). Deduped by SSID, hidden ones dropped. It does not mark
 * the one the robot is on (match RobotState.network_status.ssid) or say
 * whether a network is open, so the password stays optional.
 *
 * No AbortSignal: aborting would not stop the robot's scan, only discard an
 * answer the query cache could keep for the next visit.
 */
export function scanWifiNetworks(): Promise<WifiNetwork[]> {
  return requestJson<{ networks: WifiNetwork[] }>(
    apiUrl("/api/v1/network/wifi/scan"),
    { schema: z.object({ networks: z.array(WifiNetworkSchema) }) },
  ).then((body) => body.networks);
}

export interface ConnectWifiResult {
  /** Operator-facing; render verbatim. */
  message: string;
}

const ConnectWifiResultSchema: z.ZodType<ConnectWifiResult> = z.object({
  message: z.string(),
});

/**
 * Join a network. Blocks up to ~60 s and answers 200 only once joined; a 400
 * carries the robot's sentence (wrong password, no such SSID). An empty
 * password means an open network.
 *
 * A fetch TypeError is expected when the console reached the robot over the
 * network it is leaving: that is the connect *working*. Read it as "in
 * progress" and let RobotState.network_status report the landing.
 */
export function connectWifi(
  ssid: string,
  password: string,
): Promise<ConnectWifiResult> {
  return requestJson<ConnectWifiResult>(apiUrl("/api/v1/network/wifi/connect"), {
    method: "POST",
    body: JSON.stringify({ ssid, password }),
    schema: ConnectWifiResultSchema,
  });
}

export interface WifiConnection {
  /** The key the two writes take. */
  uuid: string;
  /** The saved profile's name; usually, not always, the SSID. */
  name: string;
  /** What the console shows and compares. */
  ssid: string;
  active: boolean;
  /** ISO 8601 (UTC); null if never joined. */
  last_used_at: string | null;
}

const WifiConnectionSchema: z.ZodType<WifiConnection> = z.object({
  uuid: z.string(),
  name: z.string(),
  ssid: z.string(),
  active: z.boolean(),
  last_used_at: z.string().nullable(),
});

/** The robot's saved networks. Cheap (no scan), so it takes the signal. */
export function listWifiConnections(signal?: AbortSignal): Promise<WifiConnection[]> {
  return requestJson<{ connections: WifiConnection[] }>(
    apiUrl("/api/v1/network/wifi/connections"),
    { signal, schema: z.object({ connections: z.array(WifiConnectionSchema) }) },
  ).then((body) => body.connections);
}

/**
 * Rejoin a saved network. Same timing and outcomes as connectWifi, including
 * the TypeError that means the switch *worked*.
 */
export function activateWifiConnection(uuid: string): Promise<ConnectWifiResult> {
  return requestJson<ConnectWifiResult>(
    apiUrl(`/api/v1/network/wifi/connections/${encodeURIComponent(uuid)}/activate`),
    { method: "POST", schema: ConnectWifiResultSchema },
  );
}

/** Forget a saved network. Refused (400) for the one the robot is on. */
export function forgetWifiConnection(uuid: string): Promise<void> {
  return requestJson<void>(
    apiUrl(`/api/v1/network/wifi/connections/${encodeURIComponent(uuid)}`),
    { method: "DELETE", parse: false },
  );
}
