import { openSession, type SessionHandlers } from "@/lib/video/signalling";

/**
 * WHEP client for the robot camera: vanilla ICE, not trickle (see
 * lib/video/signalling.ts). Receive-only, so it works from plain http.
 */

export interface WhepSession {
  readonly stream: MediaStream;
  /** From the Location header, for the DELETE. */
  readonly sessionUrl: string | null;
  readonly pc: RTCPeerConnection;
  /** Idempotent. */
  close: () => Promise<void>;
}

export type WhepHandlers = SessionHandlers;

export async function startWhepSession(
  handlers: WhepHandlers = {},
  path = "/api/v1/webrtc/whep",
): Promise<WhepSession> {
  const pc = new RTCPeerConnection({
    // Host candidates connect a console and robot on one LAN.
    iceServers: [],
  });
  const stream = new MediaStream();

  const session = await openSession(pc, path, {
    handlers,
    setup: () => {
      pc.addEventListener("track", (event) => stream.addTrack(event.track));
      // In this order: the worker sends exactly H264 video then Opus audio,
      // and needs an m-line for each.
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    },
  });

  return {
    stream,
    get sessionUrl() {
      return session.sessionUrl;
    },
    pc,
    close: session.close,
  };
}

export interface WhepStats {
  /** Null before the first frame. */
  width: number | null;
  height: number | null;
  fps: number | null;
  videoKbps: number | null;
  framesDecoded: number | null;
  videoPacketsLost: number | null;
  /** 0..1; not reported by every browser. */
  audioLevel: number | null;
  audioKbps: number | null;
  audioPacketsReceived: number | null;
  audioPacketsLost: number | null;
  /** The selected candidate pair, e.g. "host -> host". */
  candidatePair: string | null;
  roundTripMs: number | null;
}

interface ByteSample {
  bytes: number;
  at: number;
}

/**
 * Readable numbers from getStats(). RTCStats bytes are cumulative, so the
 * caller hands back the previous sample for the bitrate.
 */
export async function readWhepStats(
  pc: RTCPeerConnection,
  previous: { video?: ByteSample; audio?: ByteSample },
): Promise<{ stats: WhepStats; samples: { video?: ByteSample; audio?: ByteSample } }> {
  const report = await pc.getStats();
  const now = performance.now();

  const stats: WhepStats = {
    width: null,
    height: null,
    fps: null,
    videoKbps: null,
    framesDecoded: null,
    videoPacketsLost: null,
    audioLevel: null,
    audioKbps: null,
    audioPacketsReceived: null,
    audioPacketsLost: null,
    candidatePair: null,
    roundTripMs: null,
  };
  const samples: { video?: ByteSample; audio?: ByteSample } = {};

  const kbps = (bytes: number, prior: ByteSample | undefined) => {
    if (!prior || now <= prior.at) return null;
    return ((bytes - prior.bytes) * 8) / (now - prior.at);
  };

  report.forEach((entry) => {
    if (entry.type === "inbound-rtp" && entry.kind === "video") {
      stats.width = entry.frameWidth ?? null;
      stats.height = entry.frameHeight ?? null;
      stats.fps = entry.framesPerSecond ?? null;
      stats.framesDecoded = entry.framesDecoded ?? null;
      stats.videoPacketsLost = entry.packetsLost ?? null;
      const bytes = entry.bytesReceived ?? 0;
      stats.videoKbps = kbps(bytes, previous.video);
      samples.video = { bytes, at: now };
    }
    if (entry.type === "inbound-rtp" && entry.kind === "audio") {
      stats.audioLevel = entry.audioLevel ?? null;
      stats.audioPacketsReceived = entry.packetsReceived ?? null;
      stats.audioPacketsLost = entry.packetsLost ?? null;
      const bytes = entry.bytesReceived ?? 0;
      stats.audioKbps = kbps(bytes, previous.audio);
      samples.audio = { bytes, at: now };
    }
    if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) {
      stats.roundTripMs =
        entry.currentRoundTripTime != null ? entry.currentRoundTripTime * 1000 : null;
    }
  });

  // A second pass for the pair's candidate types: "host → host" or not is most
  // of the answer to "why is this stream slow".
  report.forEach((entry) => {
    if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) {
      const local = report.get(entry.localCandidateId);
      const remote = report.get(entry.remoteCandidateId);
      if (local && remote) {
        stats.candidatePair = `${local.candidateType} → ${remote.candidateType}`;
      }
    }
  });

  return { stats, samples };
}
