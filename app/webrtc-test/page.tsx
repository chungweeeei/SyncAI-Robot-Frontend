"use client";

import { WebRtcBench } from "@/components/webrtc/webrtc-bench";

/**
 * Route shell for the WHIP/WHEP bench.
 *
 * `lib/video/` now has an operator-screen consumer — the masthead's camera
 * window, which owns its WHEP session through `useCameraStream` — so what is
 * left here is the half no operator path touches: WHIP, and the negotiation
 * readouts that say *why* a picture is not arriving.
 *
 * The route used to 404 in a production build, because the page asks for the
 * microphone and the camera and nothing but knowing the URL is needed to open
 * it. That gate is gone on purpose: the bench has to be reachable on the robot
 * itself, where the only build that runs is the production one, or it cannot
 * test the thing it exists to test.
 *
 * What keeps it out of an operator's way is that it is unlisted — no nav rail
 * entry, opened by hand at /webrtc-test. It stays unlisted rather than gone
 * because a video fault is diagnosed here: the camera window shows one picture
 * or none, and this page shows the negotiation behind it.
 */
export default function WebRtcTestPage() {
  return <WebRtcBench />;
}
