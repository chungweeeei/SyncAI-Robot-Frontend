import { wsUrl } from "@/lib/api/config";
import {
  parseTeleopError,
  teleopTick,
  ZERO_FRAME,
} from "@/lib/ros/teleop-frame";
import type { TeleopVector } from "@/lib/types/robot";

/**
 * Outbound teleop channel — deliberately NOT createReconnectingSocket. When
 * the link drops mid-drive the backend watchdog stops the robot, and a silent
 * reconnect would resume motion with no operator act. So: one socket, no
 * retry, and any close surfaces as `onDown` so the owner disarms; re-arming
 * is a deliberate click.
 *
 * 10 Hz against the backend's 0.5 s stale-input watchdog, but only while an
 * input deflects (teleopTick): every frame becomes a cmd_vel on the robot, and
 * a stream of zeros from an armed, untouched panel is commands nobody gave.
 * A release sends one zero and then goes quiet; a background-throttled tab
 * mid-drive still goes quiet too, which the watchdog stops — the safe
 * direction.
 */

const SEND_PERIOD_MS = 100;

export interface TeleopChannelHandlers {
  onOpen?: () => void;
  /** A backend `{"error": ...}` frame, e.g. "autonomous move in progress". */
  onRefusal?: (message: string) => void;
  /** Socket closed or errored. NOT called after an explicit close(). */
  onDown?: () => void;
}

export interface TeleopChannel {
  /** Best-effort zero frame, then close. Idempotent. */
  close: () => void;
}

export function createTeleopChannel(
  vectorRef: { readonly current: TeleopVector },
  handlers: TeleopChannelHandlers,
  path = "/api/v1/robot/teleop",
): TeleopChannel {
  let sendTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let driving = false;

  const ws = new WebSocket(wsUrl(path));

  const stopSending = () => {
    if (sendTimer !== null) clearInterval(sendTimer);
    sendTimer = null;
  };

  const tick = () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const next = teleopTick(vectorRef.current, driving);
    driving = next.driving;
    if (next.frame !== null) ws.send(next.frame);
  };

  ws.onopen = () => {
    if (closed) return;
    tick();
    sendTimer = setInterval(tick, SEND_PERIOD_MS);
    handlers.onOpen?.();
  };

  ws.onmessage = (ev) => {
    const message = parseTeleopError(ev.data);
    if (message !== null) handlers.onRefusal?.(message);
  };

  // No onDown after an explicit close(): the owner closed because it disarmed.
  ws.onclose = () => {
    stopSending();
    if (!closed) handlers.onDown?.();
  };
  ws.onerror = () => {
    // onclose follows and carries onDown; this only silences the browser log.
  };

  return {
    close: () => {
      if (closed) return;
      closed = true;
      stopSending();
      if (driving && ws.readyState === WebSocket.OPEN) {
        // Defense in depth; the backend zeroes on disconnect anyway. A literal
        // zero, not vectorRef.current, so disarm effect order cannot matter.
        // Only mid-drive: a channel already at rest has nothing to stop.
        ws.send(ZERO_FRAME);
      }
      ws.close();
    },
  };
}
