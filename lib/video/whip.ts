import { apiUrl } from "@/lib/api/config";
import { errorDetail } from "@/lib/api/http";
import { resolveSessionUrl, waitForIceGathering } from "@/lib/video/signalling";

/**
 * WHIP client: the operator's microphone out of the robot's speaker.
 *
 * Unlike WHEP it needs getUserMedia, and `navigator.mediaDevices` is
 * `undefined` outside a secure context — so on http://<robot>:3001 there is
 * no microphone, which reads as a browser bug unless named. Ways out:
 *   1. Chrome, started with
 *      --unsafely-treat-insecure-origin-as-secure=http://<robot>:3001
 *      (and --user-data-dir=/tmp/whip-test so it does not fight your profile)
 *   2. Firefox, media.devices.insecure.enabled + media.getusermedia.insecure.enabled
 *   3. Serve the console over https, which is the real fix and not one this
 *      page can make.
 */

export function microphoneAvailable(): boolean {
  return typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia != null;
}

export const INSECURE_CONTEXT_MESSAGE =
  "the microphone needs a secure context; this page is plain http, so the browser " +
  "hides navigator.mediaDevices (see lib/video/whip.ts for the flags that work around it)";

export interface WhipSession {
  /** The microphone, so the caller can mute or meter it. */
  readonly stream: MediaStream;
  /** From the Location header, for the DELETE. */
  readonly sessionUrl: string | null;
  readonly pc: RTCPeerConnection;
  close: () => Promise<void>;
}

export interface WhipHandlers {
  onConnectionState?: (state: RTCPeerConnectionState) => void;
  onIceState?: (state: RTCIceConnectionState) => void;
}

export async function startWhipSession(
  handlers: WhipHandlers = {},
  path = "/api/v1/webrtc/whip",
): Promise<WhipSession> {
  if (!microphoneAvailable()) throw new Error(INSECURE_CONTEXT_MESSAGE);

  // The operator is likely hearing the robot through WHEP too; without echo
  // cancellation the loop howls.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });

  const pc = new RTCPeerConnection({ iceServers: [] });

  let sessionUrl: string | null = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    // DELETE first: a local close tells the robot nothing, and its speaker
    // stays claimed.
    if (sessionUrl) {
      try {
        await fetch(sessionUrl, { method: "DELETE", keepalive: true });
      } catch {
        /* the robot went away, or the tab is unloading — nothing to do */
      }
    }
    // Stopping the tracks turns the browser's recording indicator off.
    stream.getTracks().forEach((track) => track.stop());
    pc.close();
  };

  try {
    // sendonly, one audio track: the worker receives and offers nothing back.
    stream.getAudioTracks().forEach((track) => {
      pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
    });

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
    stream,
    get sessionUrl() {
      return sessionUrl;
    },
    pc,
    close,
  };
}

export interface WhipStats {
  /** 0..1 */
  audioLevel: number | null;
  audioKbps: number | null;
  packetsSent: number | null;
  roundTripMs: number | null;
}

interface ByteSample {
  bytes: number;
  at: number;
}

/**
 * Outbound stats from two getStats() snapshots. The level is `media-source`'s,
 * not `outbound-rtp`'s, which is silence-suppressed and makes a quiet room
 * read as a dead microphone.
 */
export async function readWhipStats(
  pc: RTCPeerConnection,
  previous: ByteSample | undefined,
): Promise<{ stats: WhipStats; sample: ByteSample | undefined }> {
  const report = await pc.getStats();
  const now = performance.now();

  const stats: WhipStats = {
    audioLevel: null,
    audioKbps: null,
    packetsSent: null,
    roundTripMs: null,
  };
  let sample: ByteSample | undefined;

  report.forEach((entry) => {
    if (entry.type === "outbound-rtp" && entry.kind === "audio") {
      stats.packetsSent = entry.packetsSent ?? null;
      const bytes = entry.bytesSent ?? 0;
      if (previous && now > previous.at) {
        stats.audioKbps = ((bytes - previous.bytes) * 8) / (now - previous.at);
      }
      sample = { bytes, at: now };
    }
    if (entry.type === "media-source" && entry.kind === "audio") {
      stats.audioLevel = entry.audioLevel ?? null;
    }
    if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) {
      stats.roundTripMs =
        entry.currentRoundTripTime != null ? entry.currentRoundTripTime * 1000 : null;
    }
  });

  return { stats, sample };
}
