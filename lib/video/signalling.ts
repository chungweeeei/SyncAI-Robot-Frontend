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
