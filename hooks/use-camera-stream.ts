"use client";

import * as React from "react";

import { startWhepSession, type WhepSession } from "@/lib/video/whep";

export type CameraPhase = "connecting" | "live" | "failed";

export interface CameraStream {
  phase: CameraPhase;
  /** The backend's own sentence when it refused, rendered verbatim. */
  error: string | null;
  /** Attach to a <video> element's srcObject. Null until the answer lands. */
  stream: MediaStream | null;
  /** Tear the session down and negotiate a new one. */
  retry: () => void;
}

/**
 * The hook layer `lib/video/` never had.
 *
 * WHIP/WHEP was built, deferred, and left with `components/webrtc/webrtc-bench`
 * driving sessions itself — the one backend interaction in this codebase a
 * component reached for directly, recorded in CLAUDE.md as debt to be paid
 * "when camera streaming comes back as a dashboard panel". This is that panel's
 * half of the bargain; the bench is still its own thing, because what it exists
 * to show is the negotiation, and a hook that hides the negotiation is no use
 * to it.
 *
 * Not a TanStack Query: there is no URL to refetch and no response to cache.
 * The RTCPeerConnection is the source of truth, exactly as the WebSocket is for
 * telemetry, and the same rule applies — a stream is not a read.
 *
 * **Mounted is watching.** The session opens on mount and closes on unmount,
 * so the caller controls the camera by rendering this or not. The robot's
 * worker holds one viewer slot, which is the reason it works that way: a hook
 * that kept a session alive for a hidden panel would be holding the camera away
 * from whoever opens the next one.
 */
export function useCameraStream(): CameraStream {
  const [phase, setPhase] = React.useState<CameraPhase>("connecting");
  const [error, setError] = React.useState<string | null>(null);
  const [stream, setStream] = React.useState<MediaStream | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const sessionRef = React.useRef<WhepSession | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // Held outside the promise so the cleanup can close a session that
    // finished negotiating after the effect was already torn down — which is
    // every Strict Mode remount, and a fast navigation on the robot too.
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

  // Closing the tab is not an unmount, and the worker has no callback that
  // would tell it the viewer went away: without this the camera stays held on
  // the robot until something else preempts the session. It closes rather than
  // reconnects — `close()` is idempotent, so the unmount that follows is free.
  React.useEffect(() => {
    const onPageHide = () => void sessionRef.current?.close();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // The reset lives here rather than at the top of the effect: the initial
  // state already is connecting/null/null, so the only run that needs clearing
  // is the one a retry asks for -- and a setState in an effect body is a
  // cascading render the compiler rightly refuses.
  const retry = React.useCallback(() => {
    setPhase("connecting");
    setError(null);
    setStream(null);
    setAttempt((n) => n + 1);
  }, []);

  return { phase, error, stream, retry };
}
