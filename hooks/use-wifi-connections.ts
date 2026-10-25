import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  WifiBusyError,
  forgetWifiConnection,
  listWifiConnections,
  type WifiConnection,
} from "@/lib/api/network";
import { mutationKeys, queryKeys } from "@/lib/api/query-keys";

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
    mutationKey: mutationKeys.wifiChange,
    mutationFn: (uuid: string) => forgetWifiConnection(uuid),
    onSuccess: () => {
      // The live network cannot be forgotten, so the state poll is untouched.
      void queryClient.invalidateQueries({ queryKey: queryKeys.wifiConnections });
    },
  });
}

/**
 * Whether a Wi-Fi join or forget from this console is still in flight, on any
 * card or page. The robot takes one at a time (409 `wifi_busy`), so the other
 * buttons grey instead of offering a press that can only be refused.
 */
export function useWifiChanging(): boolean {
  return useIsMutating({ mutationKey: mutationKeys.wifiChange }) > 0;
}

/**
 * A refusal because another Wi-Fi change is still running on the robot —
 * possibly from another console. It means "wait", so it is shown as a
 * caution, not as the network refusing the request.
 */
export function isWifiBusy(error: unknown): boolean {
  return error instanceof WifiBusyError;
}
