"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { isWifiBusy, useWifiChanging } from "@/hooks/use-wifi-connections";
import {
  activateWifiConnection,
  connectWifi,
  type WifiConnection,
} from "@/lib/api/network";
import { mutationKeys, queryKeys } from "@/lib/api/query-keys";
import type { RobotNetworkStatus } from "@/lib/types/robot";

/** How a connect attempt ended. */
export type WifiConnectOutcome = "ok" | "dropped" | "error";

/**
 * A new network by SSID and password, or a saved one by id. One mutation for
 * both: they share the hard parts (a request that can kill its own responder,
 * `pending` against the poll), and the robot joins one network at a time.
 */
type JoinRequest =
  | { kind: "connect"; ssid: string; password: string }
  | { kind: "activate"; uuid: string; ssid: string };

export interface WifiConnect {
  /** RobotState.network_status from the shared 1 Hz poll. */
  current: RobotNetworkStatus | null;
  stateStatus: "loading" | "ok" | "error";
  /**
   * The SSID a connect is heading for. Derived: null the moment a state frame
   * reports that SSID, as with useModeSwitch's `pending`.
   */
  pending: string | null;
  /** The POST is in flight (up to ~70 s). */
  busy: boolean;
  /**
   * Any Wi-Fi join or forget from this console is in flight, this hook's or
   * not: the robot refuses a second one, so every such button greys on it.
   */
  changing: boolean;
  /**
   * The uuid of the saved network the latest join rejoined, null for a join by
   * SSID: a card checks it before showing busy, message or error as its own.
   */
  savedTarget: string | null;
  /** The backend's success sentence, or the dropped-connection notice. */
  message: string | null;
  /** The backend's 400/409/502 sentence. */
  error: string | null;
  /**
   * The error is 409 `wifi_busy`: another change (perhaps another console's)
   * was still running, so this one was not tried. A "wait", not a failure.
   */
  errorBusy: boolean;
  connect: (ssid: string, password: string) => Promise<WifiConnectOutcome>;
  /** Rejoin a saved network, with the password the robot kept. */
  activate: (connection: WifiConnection) => Promise<WifiConnectOutcome>;
}

/**
 * Command a Wi-Fi connect and watch it land.
 *
 * Like useModeSwitch, the request can kill its own responder: leaving the
 * network the console uses drops the POST and fetch throws a TypeError, which
 * is the connect *working*. So the request is recorded before the call, that
 * error is forgiven, and `pending` reads against the state poll.
 *
 * Unlike it, a 200 clears the request itself: it comes only after nmcli exited
 * 0, and the robot's Wi-Fi status refreshes every 5 s, so the poll alone would
 * leave "Connecting…" up for seconds.
 *
 * Invalidates `wifiConnections` on settle, not success: a dropped join has
 * probably landed, and a refused one by SSID can still leave a saved network.
 */
export function useWifiConnect(): WifiConnect {
  const { state, status } = useConsoleRobotState();
  const queryClient = useQueryClient();
  const [requested, setRequested] = React.useState<string | null>(null);

  const current = state?.network_status ?? null;

  // Derived, so it also settles however the robot got there.
  const pending = requested && requested !== current?.ssid ? requested : null;

  const changing = useWifiChanging();

  const request = useMutation({
    mutationKey: mutationKeys.wifiChange,
    mutationFn: (join: JoinRequest) =>
      join.kind === "connect"
        ? connectWifi(join.ssid, join.password)
        : activateWifiConnection(join.uuid),
    // Before the call: the request may kill its own responder.
    onMutate: ({ ssid }) => {
      setRequested(ssid);
    },
    onSuccess: () => setRequested(null),
    onError: (cause) => {
      // A dropped connection is expected; keep `pending` and let the poll
      // report the landing.
      if (cause instanceof TypeError) return;
      // An HTTP refusal (400 / 409 / 502): the join did not happen.
      setRequested(null);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.wifiConnections });
    },
  });

  const { mutateAsync: requestConnect } = request;

  const join = React.useCallback(
    (request: JoinRequest): Promise<WifiConnectOutcome> =>
      requestConnect(request).then(
        () => "ok",
        (cause) => (cause instanceof TypeError ? "dropped" : "error"),
      ),
    [requestConnect],
  );

  const connect = React.useCallback(
    (ssid: string, password: string) => join({ kind: "connect", ssid, password }),
    [join],
  );

  const activate = React.useCallback(
    (connection: WifiConnection) =>
      join({ kind: "activate", uuid: connection.uuid, ssid: connection.ssid }),
    [join],
  );

  const dropped = request.error instanceof TypeError;

  return {
    current,
    stateStatus: status,
    pending,
    busy: request.isPending,
    changing,
    savedTarget:
      request.variables?.kind === "activate" ? request.variables.uuid : null,
    // A drop is not reported as a failure, but as what to do next.
    message: request.data?.message ?? (dropped ? droppedNotice(request.variables?.ssid) : null),
    error: dropped ? null : (request.error?.message ?? null),
    errorBusy: isWifiBusy(request.error),
    connect,
    activate,
  };
}

function droppedNotice(ssid: string | undefined): string {
  return (
    "The connection dropped mid-request — expected when this console reached " +
    "the robot over the network it is leaving. If the page loses the robot, " +
    `reopen the console at its address on ${ssid ?? "the new network"}.`
  );
}
