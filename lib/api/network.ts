// Client for the backend's network API: which WiFi networks the robot can see
// and telling it to join one.
// (backend: src/syncai_backend/syncai_backend/interfaces/rest/routers/network.py,
//  which forwards to sys_manager's scan_wifi / connect_wifi ROS services)

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

export interface WifiNetwork {
  /** Access-point MAC. For an SSID served by several APs this is whichever
   *  nmcli listed first (strongest), the list being deduped by SSID. */
  bssid: string;
  ssid: string;
  /** dBm. sys_manager folds nmcli's 0–100 SIGNAL to dBm as ceil(s/2 − 100). */
  rssi: number;
}

/**
 * Scan for the networks visible to the robot.
 *
 * Slow by nature: sys_manager runs `nmcli device wifi rescan` (up to 10 s) and
 * then lists, and the gateway waits up to 45 s for the answer. The list is
 * deduped by SSID and drops hidden SSIDs. Two things it does *not* say: which
 * entry the robot is on — it is in the list but unmarked, so callers match it
 * against RobotState.network_status.ssid — and whether a network is open or
 * WPA, which is why the password stays optional at the UI.
 *
 * Deliberately takes no AbortSignal, unlike the other clients here. Aborting
 * the fetch when the Settings card unmounts would not stop nmcli on the robot;
 * it would only throw away an answer that is about to arrive. Letting the
 * request run to completion lands the list in the query cache for the next
 * visit instead. A 502 carries the ROS-side reason in `detail`.
 */
const WifiNetworkSchema: z.ZodType<WifiNetwork> = z.object({
  bssid: z.string(),
  ssid: z.string(),
  rssi: z.number(),
});

export function scanWifiNetworks(): Promise<WifiNetwork[]> {
  return requestJson<{ networks: WifiNetwork[] }>(
    apiUrl("/api/v1/network/wifi/scan"),
    { schema: z.object({ networks: z.array(WifiNetworkSchema) }) },
  ).then((body) => body.networks);
}

export interface ConnectWifiResult {
  /** "Successfully connected to <ssid>" — operator-facing, render verbatim. */
  message: string;
}

const ConnectWifiResultSchema: z.ZodType<ConnectWifiResult> = z.object({
  message: z.string(),
});

/**
 * Ask sys_manager to `nmcli device wifi connect` the given network.
 *
 * Blocks for as long as nmcli does — up to 60 s on the robot, 70 s at the
 * gateway — and answers 200 only after nmcli exited 0, so a resolved call is
 * an authoritative "joined". A 400 carries nmcli's own sentence in `detail`
 * (wrong password, no such SSID); useWifiConnect renders it verbatim.
 *
 * The other outcome to expect is a fetch TypeError: when the console reached
 * the robot over the very network it is leaving, the connection drops before
 * the response is written, and that is the connect *working*. Callers must
 * read it as "in progress" rather than failure (useWifiConnect does) and let
 * RobotState.network_status report the landing. An empty password means an
 * open network — sys_manager omits the password argument entirely.
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
  /** NetworkManager's id for the saved network; the key the two writes take. */
  uuid: string;
  /** The saved network's own name. Usually the SSID, but nmcli lets it differ. */
  name: string;
  /** The SSID the robot joins with it — what the console shows and compares. */
  ssid: string;
  /** True for the one the robot is on right now. */
  active: boolean;
  /** ISO 8601 (UTC) of the last time the robot joined it; null if never. */
  last_used_at: string | null;
}

const WifiConnectionSchema: z.ZodType<WifiConnection> = z.object({
  uuid: z.string(),
  name: z.string(),
  ssid: z.string(),
  active: z.boolean(),
  last_used_at: z.string().nullable(),
});

/**
 * The networks the robot has saved — every one it has joined before, with its
 * password kept on the robot. Cheap (a profile read, no radio scan), so unlike
 * scanWifiNetworks it takes the query's signal.
 */
export function listWifiConnections(signal?: AbortSignal): Promise<WifiConnection[]> {
  return requestJson<{ connections: WifiConnection[] }>(
    apiUrl("/api/v1/network/wifi/connections"),
    { signal, schema: z.object({ connections: z.array(WifiConnectionSchema) }) },
  ).then((body) => body.connections);
}

/**
 * Rejoin a saved network with the password the robot kept. Same timing and
 * same two outcomes as connectWifi: a 200 only once the robot is on it, or a
 * fetch TypeError when the console was reaching the robot over the network it
 * just left — which is the switch *working*, and has to be read that way.
 */
export function activateWifiConnection(uuid: string): Promise<ConnectWifiResult> {
  return requestJson<ConnectWifiResult>(
    apiUrl(`/api/v1/network/wifi/connections/${encodeURIComponent(uuid)}/activate`),
    { method: "POST", schema: ConnectWifiResultSchema },
  );
}

/**
 * Forget a saved network. A 204; the robot refuses (400, its own sentence) to
 * forget the one it is on, since that would take it off the network.
 */
export function forgetWifiConnection(uuid: string): Promise<void> {
  return requestJson<void>(
    apiUrl(`/api/v1/network/wifi/connections/${encodeURIComponent(uuid)}`),
    { method: "DELETE", parse: false },
  );
}
