/**
 * The robot's cameras as the camera window shows them. One WHEP session
 * carries up to two: the worker sends its first camera (the front one) on the
 * offer's first video m-line and a second (the M20's rear one) on the second,
 * and answers that line inactive on a robot with one camera. So which cameras
 * exist is read off the answer, never guessed from the robot's model.
 */

export type CameraId = "front" | "rear";

export const CAMERA_LABEL: Record<CameraId, string> = {
  front: "Front",
  rear: "Rear",
};

export interface CameraFeed {
  id: CameraId;
  /** The camera's picture with the robot's audio, for a <video>'s srcObject. */
  stream: MediaStream;
}

/**
 * Whether the answer gave a receive-only line something to carry. Null is a
 * line the answer never negotiated; `inactive` is the worker saying it has
 * no camera for it.
 */
export function carriesMedia(
  direction: RTCRtpTransceiverDirection | null | undefined,
): boolean {
  return direction === "recvonly" || direction === "sendrecv";
}

export interface CameraView {
  /** The camera filling the window. */
  main: CameraId;
  /** Whether the other camera is drawn small over it. */
  pip: boolean;
}

export const INITIAL_CAMERA_VIEW: CameraView = { main: "front", pip: false };

export function otherCamera(id: CameraId): CameraId {
  return id === "front" ? "rear" : "front";
}

/**
 * The view as it can actually be drawn from the cameras the session has.
 * Derived rather than corrected in state: a retry that comes back with one
 * camera must not leave the window on a rear picture that no longer exists,
 * and the operator's choice comes back if the second one does.
 */
export function shownView(view: CameraView, cameras: readonly CameraFeed[]): CameraView {
  const has = (id: CameraId) => cameras.some((camera) => camera.id === id);
  if (has(view.main) && has(otherCamera(view.main))) return view;
  return { main: has(view.main) ? view.main : "front", pip: false };
}
