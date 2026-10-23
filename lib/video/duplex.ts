import { openSession, type SessionHandlers } from "@/lib/video/signalling";
import { INSECURE_CONTEXT_MESSAGE, microphoneAvailable } from "@/lib/video/whip";

/**
 * Both directions over one peer connection: camera in, microphone out, on its
 * own endpoint since WHEP and WHIP are each one-way. Over a WHEP plus a WHIP
 * session it saves a handshake and a gathering wait, and both directions live
 * or die together.
 *
 * The m-line order is the contract — the worker matches its tracks by kind,
 * in order, and does not answer two audio m-lines:
 *
 *   m-line 0   video   recvonly    the camera
 *   m-line 1   audio   sendrecv    microphone up, robot audio down
 *
 * Needs a secure context for getUserMedia; see lib/video/whip.ts.
 */

export interface DuplexSession {
  /** Inbound camera and robot audio. */
  readonly remote: MediaStream;
  /** The microphone, so the caller can mute or meter it. */
  readonly local: MediaStream;
  readonly sessionUrl: string | null;
  readonly pc: RTCPeerConnection;
  close: () => Promise<void>;
}

export type DuplexHandlers = SessionHandlers;

export async function startDuplexSession(
  handlers: DuplexHandlers = {},
  path = "/api/v1/webrtc/duplex",
): Promise<DuplexSession> {
  if (!microphoneAvailable()) throw new Error(INSECURE_CONTEXT_MESSAGE);

  // Echo cancellation matters here: the robot's audio plays out of the local
  // speakers.
  const local = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });

  const pc = new RTCPeerConnection({ iceServers: [] });
  const remote = new MediaStream();

  const session = await openSession(pc, path, {
    handlers,
    setup: () => {
      pc.addEventListener("track", (event) => remote.addTrack(event.track));
      // Order is the contract (see the header).
      pc.addTransceiver("video", { direction: "recvonly" });
      const [micTrack] = local.getAudioTracks();
      if (!micTrack) throw new Error("getUserMedia returned no audio track");
      pc.addTransceiver(micTrack, { direction: "sendrecv", streams: [local] });
    },
    release: () => local.getTracks().forEach((track) => track.stop()),
  });

  return {
    remote,
    local,
    get sessionUrl() {
      return session.sessionUrl;
    },
    pc,
    close: session.close,
  };
}
