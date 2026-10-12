import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  forgetWifiConnection,
  listWifiConnections,
  type WifiConnection,
} from "@/lib/api/network";
import { queryKeys } from "@/lib/api/query-keys";

export interface UseWifiConnections {
  /** The saved networks, or null before the first answer. */
  connections: WifiConnection[] | null;
  status: "loading" | "ok" | "error";
  /** The backend's sentence for a failed read. */
  error: string | null;
  /** When the list was read, for "… ago" — never Date.now() in render. */
  readAtMs: number;
  retry: () => void;
}

/**
 * The networks saved on the robot. Not polled — see the key's note: every
 * change to the list that this console can see coming is its own write, and
 * those invalidate.
 */
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
      // The list is the only thing a forget changes; the network the robot
      // is on cannot be forgotten, so the state poll is untouched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.wifiConnections });
    },
  });
}
