import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  forgetWifiConnection,
  listWifiConnections,
  type WifiConnection,
} from "@/lib/api/network";
import { queryKeys } from "@/lib/api/query-keys";

export interface UseWifiConnections {
  connections: WifiConnection[] | null;
  status: "loading" | "ok" | "error";
  error: string | null;
  /** When the list was read, for "… ago" — never Date.now() in render. */
  readAtMs: number;
  retry: () => void;
}

/** The networks saved on the robot. Not polled (see the key's note). */
export function useWifiConnections(): UseWifiConnections {
  const query = useQuery({
    queryKey: queryKeys.wifiConnections,
    queryFn: ({ signal }) => listWifiConnections(signal),
  });

  return {
    connections: query.data ?? null,
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    error: query.error?.message ?? null,
    readAtMs: query.dataUpdatedAt,
    retry: () => void query.refetch(),
  };
}

/** Forget one saved network (DELETE …/connections/{uuid}). */
export function useForgetWifiConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => forgetWifiConnection(uuid),
    onSuccess: () => {
      // The live network cannot be forgotten, so the state poll is untouched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.wifiConnections });
    },
  });
}
