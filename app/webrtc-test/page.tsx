"use client";

import { WebRtcBench } from "@/components/webrtc/webrtc-bench";

/**
 * Route shell for the WHIP/WHEP bench.
 *
 * `lib/video/` has no operator-screen consumer: camera streaming was built,
 * considered and deferred, and this bench is the only thing that exercises it.
 * The route used to 404 in a production build, because the page asks for the
 * microphone and the camera and nothing but knowing the URL is needed to open
 * it. That gate is gone on purpose: the bench has to be reachable on the robot
 * itself, where the only build that runs is the production one, or it cannot
 * test the thing it exists to test.
 *
 * What keeps it out of an operator's way is that it is unlisted — no nav rail
 * entry, opened by hand at /webrtc-test. When the WebRTC layer comes back as a
 * dashboard panel it gets a hook like every other backend interaction and this
 * route can go.
 */
export default function WebRtcTestPage() {
  return <WebRtcBench />;
}
