"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { connectWifi } from "@/lib/api/network";
import type { RobotNetworkStatus } from "@/lib/types/robot";

/** How a connect attempt ended, for the caller to decide what to do with the form. */
export type WifiConnectOutcome = "ok" | "dropped" | "error";

export interface WifiConnect {
  /** RobotState.network_status from the shared 1 Hz poll, or null before the first frame. */
  current: RobotNetworkStatus | null;
  /** The state poll's health, for the readout's "why is this blank" footnote. */
  stateStatus: "loading" | "ok" | "error";
  /**
   * The SSID a connect is in flight towards, or null. Derived, not stored: the
   * moment a state frame reports that SSID this is null again, with no effect
   * to clear it — the same shape as useModeSwitch's `pending`.
   */
  pending: string | null;
  /** True while the POST itself is in flight (up to ~70 s). */
  busy: boolean;
  /** The backend's success sentence, or the dropped-connection notice. */
  message: string | null;
  /** The backend's 400/502 sentence. */
  error: string | null;
  connect: (ssid: string, password: string) => Promise<WifiConnectOutcome>;
}

/**
 * Command a WiFi connect and watch it land.
 *
 * Modelled on useModeSwitch — the other request in this console that can kill
 * its own responder: when the console reached the robot over the network being
 * left, the POST's connection drops and fetch throws a TypeError, which is the
 * connect *working*. So the request is recorded before the call, the network
 * error is forgiven, and `pending` compares the request against what the state
 * poll reports.
 *
 * One deliberate difference: a resolved 200 clears the request itself instead
 * of waiting for the poll. The backend answers 200 only after nmcli exited 0,
 * which is stronger evidence than a state frame — and sys_manager refreshes
 * its wifi status on a slow timer (5 s), so leaning on the poll alone would
 * leave "Connecting…" on screen for seconds after the join succeeded. The poll
 * still matters for the dropped case, where no response ever arrives.
 */
export function useWifiConnect(): WifiConnect {
  const { state, status } = useConsoleRobotState();
  const [requested, setRequested] = React.useState<string | null>(null);

  const current = state?.network_status ?? null;

  // Derived, not stored — see the interface doc. Also self-corrects a connect
  // requested from another console: whatever we asked for stops pending the
  // moment the robot reports it, however it got there.
  const pending = requested && requested !== current?.ssid ? requested : null;

  const request = useMutation({
    mutationFn: ({ ssid, password }: { ssid: string; password: string }) =>
      connectWifi(ssid, password),
    // Recorded before the call, not after: the request may kill its own
    // responder, so "the POST resolved" is not the moment the join began.
    onMutate: ({ ssid }) => {
      setRequested(ssid);
    },
    onSuccess: () => setRequested(null),
    onError: (cause) => {
      // fetch's network-level failure: the connection dropped because the
      // robot left the network this console was using. Expected; keep the
      // request so `pending` shows, and let the state poll report the landing —
      // if it can still reach the robot at all.
      if (cause instanceof TypeError) return;
      // An HTTP-level refusal (nmcli's sentence in a 400, a 502 from the ROS
      // side): the join did not happen, so it must not be shown as pending.
      setRequested(null);
    },
  });

  const { mutateAsync: requestConnect } = request;

  const connect = React.useCallback(
    (ssid: string, password: string): Promise<WifiConnectOutcome> =>
      requestConnect({ ssid, password }).then(
        () => "ok",
        (cause) => (cause instanceof TypeError ? "dropped" : "error"),
      ),
    [requestConnect],
  );

  const dropped = request.error instanceof TypeError;

  return {
    current,
    stateStatus: status,
    pending,
    busy: request.isPending,
    // The success sentence, or — for the drop, which is not a failure to report
    // as one — what to do about a console that may have just lost the robot.
    message: request.data?.message ?? (dropped ? droppedNotice(request.variables?.ssid) : null),
    error: dropped ? null : (request.error?.message ?? null),
    connect,
  };
}

function droppedNotice(ssid: string | undefined): string {
  return (
    "The connection dropped mid-request — expected when this console reached " +
    "the robot over the network it is leaving. If the page loses the robot, " +
    `reopen the console at its address on ${ssid ?? "the new network"}.`
  );
}
