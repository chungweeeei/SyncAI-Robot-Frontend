"use client";

import { WebRtcBench } from "@/components/webrtc/webrtc-bench";

/**
 * Route shell for the WHIP/WHEP bench: WHIP, and the negotiation readouts that
 * say *why* a picture is not arriving. Reachable in every build, since the
 * robot runs a production one; kept off an operator's path by being unlisted.
 */
export default function WebRtcTestPage() {
  return <WebRtcBench />;
}
