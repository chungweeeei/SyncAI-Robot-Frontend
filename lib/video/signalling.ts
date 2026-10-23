import { apiUrl } from "@/lib/api/config";
import { errorDetail } from "@/lib/api/http";

/**
 * What WHEP and WHIP share. The robot's worker is single-shot (one offer, one
 * complete answer), so both need a complete offer and the session URL.
 */

/**
 * Cap on ICE gathering before the offer goes anyway. Host candidates take tens
 * of ms; the cap is for a public STUN server on a robot with no internet.
 * Host candidates alone are enough on the LAN.
 */
export const ICE_GATHERING_TIMEOUT_MS = 3000;

/**
 * Resolve once gathering completes, or at the timeout. There is no trickle
 * PATCH and no renegotiation, so an offer sent early carries no candidates
 * and never connects.
 */
export function waitForIceGathering(pc: RTCPeerConnection): Promise<boolean> {
  if (pc.iceGatheringState === "complete") return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (complete: boolean) => {
      if (settled) return;
      settled = true;
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve(complete);
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish(true);
    };

    pc.addEventListener("icegatheringstatechange", onChange);
    const timer = setTimeout(() => finish(false), ICE_GATHERING_TIMEOUT_MS);
  });
}

/**
 * Resolve the (deliberately relative) Location header against the request URL.
 * Null is usually CORS: without Access-Control-Expose-Headers: Location the
 * browser hides it, the stream still works, and teardown silently never runs.
 */
export function resolveSessionUrl(response: Response, requestUrl: string): string | null {
  const location = response.headers.get("Location");
  if (!location) return null;
  try {
    return new URL(location, response.url || requestUrl).toString();
  } catch {
    return null;
  }
}

export interface SessionHandlers {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceState?: (state: RTCIceConnectionState) => void;
}

export interface SignalledSession {
  /** From the Location header, for the DELETE. */
  readonly sessionUrl: string | null;
  /** Idempotent. */
  close: () => Promise<void>;
}

/**
 * Open one session against the robot's single-shot worker: offer, gather
 * every candidate, POST the SDP, take the answer. The same handshake for
 * WHEP, WHIP and the duplex endpoint; what differs is `setup` (the
 * transceivers, whose order is each endpoint's contract) and `release`
 * (a microphone to stop).
 *
 * A failure anywhere — `setup` included — closes the session before it
 * rethrows, so a refused offer never leaves the microphone live or the
 * robot's camera claimed.
 */
export async function openSession(
  pc: RTCPeerConnection,
  path: string,
  {
    handlers = {},
    setup,
    release,
  }: { handlers?: SessionHandlers; setup?: () => void; release?: () => void },
): Promise<SignalledSession> {
  let sessionUrl: string | null = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    // DELETE first: a local close tells the robot nothing, and its camera or
    // speaker stays claimed.
    if (sessionUrl) {
      try {
        await fetch(sessionUrl, { method: "DELETE", keepalive: true });
      } catch {
        /* the robot went away, or the tab is unloading — nothing to do */
      }
    }
    // Stopping a local track turns the browser's recording indicator off.
    release?.();
    pc.close();
  };

  try {
    setup?.();

    if (handlers.onConnectionState) {
      pc.addEventListener("connectionstatechange", () =>
        handlers.onConnectionState?.(pc.connectionState),
      );
    }
    if (handlers.onIceState) {
      pc.addEventListener("iceconnectionstatechange", () =>
        handlers.onIceState?.(pc.iceConnectionState),
      );
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGathering(pc);

    const url = apiUrl(path);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      // localDescription, not `offer`: it carries the gathered candidates.
      body: pc.localDescription?.sdp ?? offer.sdp ?? "",
    });

    if (!response.ok) throw new Error(await errorDetail(response));

    sessionUrl = resolveSessionUrl(response, url);
    const answer = await response.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  } catch (error) {
    await close();
    throw error;
  }

  return {
    get sessionUrl() {
      return sessionUrl;
    },
    close,
  };
}
