"use client";

import * as React from "react";

import {
  pickClipFormat,
  startClipCapture,
  type ClipCapture,
  type ClipFormat,
  type ClipOutcome,
} from "@/lib/video/clip";

/** Probed once: useSyncExternalStore needs the same snapshot on every read. */
let probed: ClipFormat | null | undefined;
function clipFormat(): ClipFormat | null {
  if (probed === undefined) probed = pickClipFormat();
  return probed;
}

const neverChanges = () => () => {};

export interface CameraClip {
  /** False when this browser can write no video file at all. */
  supported: boolean;
  capturing: boolean;
  /** Advances only when bytes arrive, so a stalled encoder shows as a stalled clock. */
  elapsedSeconds: number;
  bytes: number;
  /** The capture that just ended, for the receipt. */
  last: ClipOutcome | null;
  start: () => void;
  stop: () => void;
  dismiss: () => void;
}

/**
 * The camera window's clip capture — React glue over `lib/video/clip.ts`.
 *
 * **The capture is born in an event handler, never in an effect**, so it
 * outlives the component: closing the window ends the session, but the
 * recorder's listeners still hold the handle and the file still lands. Strict
 * Mode's double-mount starts nothing.
 */
export function useCameraClip(stream: MediaStream | null): CameraClip {
  // Not probed in an effect: the server snapshot is null (no MediaRecorder) and
  // the client gets the answer after hydration without a mismatch.
  const format = React.useSyncExternalStore(neverChanges, clipFormat, () => null);
  const [capturing, setCapturing] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [bytes, setBytes] = React.useState(0);
  const [last, setLast] = React.useState<ClipOutcome | null>(null);

  const captureRef = React.useRef<ClipCapture | null>(null);
  const streamRef = React.useRef(stream);

  const start = React.useCallback(() => {
    if (captureRef.current || !stream || !format) return;

    setLast(null);
    const capture = startClipCapture(stream, format, {
      onProgress: ({ elapsedMs, bytes: written }) => {
        setElapsedSeconds(Math.floor(elapsedMs / 1_000));
        setBytes(written);
      },
      onFinish: (outcome) => {
        captureRef.current = null;
        setCapturing(false);
        setElapsedSeconds(0);
        setBytes(0);
        setLast(outcome);
      },
    });

    if (!capture) {
      // A live phase can precede the track by a frame; nothing to record yet.
      setLast({
        end: "error",
        elapsedMs: 0,
        bytes: 0,
        filename: null,
        error: null,
      });
      return;
    }

    captureRef.current = capture;
    setCapturing(true);
  }, [format, stream]);

  const stop = React.useCallback(() => captureRef.current?.stop("operator"), []);
  const dismiss = React.useCallback(() => setLast(null), []);

  // MediaRecorder cannot be re-pointed, so a new stream ends the capture. The
  // track's `ended` can lag; whichever comes first wins, and finish runs once.
  React.useEffect(() => {
    if (streamRef.current === stream) return;
    streamRef.current = stream;
    captureRef.current?.stop("source");
  }, [stream]);

  // Empty deps and a ref on purpose: a dep on `stream` or `capturing` would
  // kill a live capture on the next render.
  React.useEffect(() => () => captureRef.current?.stop("closed"), []);

  // A flush on `pagehide` would hand its blob to a page that is gone, so ask
  // before unload while a capture is live.
  React.useEffect(() => {
    if (!capturing) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [capturing]);

  return {
    supported: format !== null,
    capturing,
    elapsedSeconds,
    bytes,
    last,
    start,
    stop,
    dismiss,
  };
}
