"use client";

import * as React from "react";

import { startWhepSession, type WhepSession } from "@/lib/video/whep";

export type CameraPhase = "connecting" | "live" | "failed";

export interface CameraStream {
  phase: CameraPhase;
  /** The backend's sentence when it refused, verbatim. */
  error: string | null;
  /** For a <video>'s srcObject; null until the answer lands. */
  stream: MediaStream | null;
  retry: () => void;
}

/**
 * The camera window's WHEP session. Not a query: the RTCPeerConnection is the
 * source of truth, as the WebSocket is for telemetry.
 *
 * **Mounted is watching.** The session opens on mount and closes on unmount:
 * the robot holds one viewer slot, and a session kept alive for a hidden panel
 * would hold the camera away from the next viewer.
 */
export function useCameraStream(): CameraStream {
  const [phase, setPhase] = React.useState<CameraPhase>("connecting");
  const [error, setError] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const sessionRef = React.useRef<WhepSession | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // Outside the promise, so cleanup can close a session that finished
    // negotiating after teardown (every Strict Mode remount).
    let opened: WhepSession | null = null;

    void (async () => {
      try {
        const session = await startWhepSession();
        if (cancelled) {
          await session.close();
          return;
        }
        opened = session;
        sessionRef.current = session;
        setStream(session.stream);
        setPhase("live");
      } catch (e) {
        if (cancelled) return;
        setPhase("failed");
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      void opened?.close();
      if (sessionRef.current === opened) sessionRef.current = null;
    };
  }, [attempt]);

  // Closing the tab is not an unmount, and the robot never learns the viewer
  // left, so the slot would stay held. `close()` is idempotent.
  React.useEffect(() => {
    const onPageHide = () => void sessionRef.current?.close();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Reset here, not in the effect: only a retry needs it, and a setState in an
  // effect body is a cascading render the compiler refuses.
  const retry = React.useCallback(() => {
    setPhase("connecting");
    setError(null);
    setStream(null);
    setAttempt((n) => n + 1);
  }, []);

  return { phase, error, stream, retry };
}
