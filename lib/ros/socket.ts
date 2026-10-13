import { wsUrl } from "@/lib/api/config";
import type { StreamStatus } from "@/lib/types/stream";

/**
 * Fixed, not exponential: it recovers from a backend restart on the LAN, and
 * one console per robot is no thundering herd.
 */
const RECONNECT_DELAY_MS = 2000;

export interface ReconnectingSocketOptions {
  /**
   * Raw payload, not narrowed: each stream discards the kind it does not want,
   * so an unexpected frame cannot kill the connection.
   */
  onMessage: (data: string | ArrayBuffer | Blob) => void;
  onStatus?: (status: StreamStatus) => void;
  binaryType?: BinaryType;
}

export interface ReconnectingSocket {
  close: () => void;
}

/**
 * Open a backend WebSocket that reconnects until closed.
 *
 * WHY the scan and telemetry are separate sockets: **backpressure**, not
 * format. One socket is one ordered TCP stream, so a few-hundred-KB scan frame
 * would head-of-line block the 20 Hz pose behind it. Both backend loops read a
 * single-slot cache and skip what the client has seen (`after_seq`), so a slow
 * client is *supposed* to drop frames; one shared socket would turn "drop the
 * stale pose" into "deliver a late pose", which a 3D viewer must not do.
 */
export function createReconnectingSocket(
  path: string,
  opts: ReconnectingSocketOptions,
): ReconnectingSocket {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    opts.onStatus?.("connecting");
    ws = new WebSocket(wsUrl(path));
    if (opts.binaryType) ws.binaryType = opts.binaryType;

    ws.onopen = () => opts.onStatus?.("open");
    ws.onmessage = (ev) => opts.onMessage(ev.data);
    ws.onerror = () => opts.onStatus?.("error");
    ws.onclose = () => {
      // Reported on an explicit close() too: a caller can stop a stream without
      // unmounting (the mapping screen's "Map so far" toggle), and the status
      // badge would otherwise read "open" with no socket behind it.
      opts.onStatus?.("closed");
      if (!closed) {
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
