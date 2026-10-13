import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { scanWifiNetworks, type WifiNetwork } from "@/lib/api/network";
import { queryKeys } from "@/lib/api/query-keys";

export type WifiScanStatus = "loading" | "ok" | "error";

export interface UseWifiScan {
  /** The last successful scan; a failed rescan keeps it. */
  networks: WifiNetwork[] | null;
  status: WifiScanStatus;
  /** Any scan, first or rescan, is in flight. */
  scanning: boolean;
  error: string | null;
  /** Start another scan (~45 s); a no-op while one runs. */
  rescan: () => void;
}

/**
 * The networks the robot can see. A scan costs up to 45 s on the robot, so it
 * is fetched once on first mount and then only by `rescan()` (`staleTime:
 * Infinity`); opening the page is already the explicit act. `gcTime` is raised
 * so a detour does not evict a 45 s list.
 *
 * `rescan` uses `refetch()`: one observer, and the button means "start now".
 */
export function useWifiScan(): UseWifiScan {
  const { data, isPending, isError, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.wifiScan,
    // No `signal` on purpose: see scanWifiNetworks.
    queryFn: scanWifiNetworks,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

  const rescan = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    networks: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    scanning: isFetching,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
    rescan,
  };
}
