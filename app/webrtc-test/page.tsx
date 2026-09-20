"use client";

import { notFound } from "next/navigation";

import { WebRtcBench } from "@/components/webrtc/webrtc-bench";

/**
 * Route shell for the WHIP/WHEP bench — and the gate that keeps it off the
 * robot.
 *
 * `lib/video/` has no operator-screen consumer: camera streaming was built,
 * considered and deferred, and this bench is the only thing that exercises it.
 * That is fine in development and not fine on a machine in a building, because
 * the page asks for the microphone and the camera and nothing but knowing the
 * URL is needed to open it. `NODE_ENV` is inlined at build time, so on the
 * robot this reads `if (true) notFound()`.
 *
 * It is a 404 rather than a deletion because the WebRTC layer is meant to come
 * back as a dashboard panel; when it does, it gets a hook like every other
 * backend interaction and this route can go.
 *
 * The guard sits in its own component so the bench's hooks are never behind a
 * conditional return.
 */
export default function WebRtcTestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WebRtcBench />;
}
