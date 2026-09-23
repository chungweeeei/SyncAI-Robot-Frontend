"use client";

import * as React from "react";

import {
  pickClipFormat,
  startClipCapture,
  type ClipCapture,
  type ClipFormat,
  type ClipOutcome,
} from "@/lib/video/clip";

/**
 * Probed once per document and cached, because useSyncExternalStore needs a
 * snapshot that is the same value every time it is read — and because asking
 * the browser twice cannot produce a different answer.
 */
let probed: ClipFormat | null | undefined;
function clipFormat(): ClipFormat | null {
  if (probed === undefined) probed = pickClipFormat();
  return probed;
}

/** Nothing ever changes it, so the subscription is a formality. */
const neverChanges = () => () => {};

export interface CameraClip {
  /** False while this browser can write no video file at all. */
  supported: boolean;
  capturing: boolean;
  /** Advances only when bytes arrive, so a stalled encoder shows as a stalled clock. */
  elapsedSeconds: number;
  bytes: number;
  /** The capture that just ended, for the receipt. Cleared by `dismiss`. */
  last: ClipOutcome | null;
  start: () => void;
  stop: () => void;
  dismiss: () => void;
}

/**
 * The camera window's clip capture.
 *
 * React glue only: every rule about what a clip is lives in `lib/video/clip.ts`,
 * and this hook holds the handle, mirrors its progress into state for the
 * readout, and makes sure a capture is never silently lost.
 *
 * **The capture is born in an event handler, never in an effect.** That is what
 * makes it survive the component: closing the disclosure unmounts the window
 * and `useCameraStream`'s cleanup closes the session, but the handle is still
 * held by its own recorder's listeners and the file still lands. It is also
 * what makes Strict Mode's double-mount a non-event — no effect here starts
 * anything.
 */
export function useCameraClip(stream: MediaStream | null): CameraClip {
  /**
   * Read through useSyncExternalStore rather than probed in an effect: the
   * server has no MediaRecorder, so the server snapshot is null and the client
   * gets the real answer after hydration, with no setState cascade and no
   * render that disagrees with the HTML it is reconciling against.
   */
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
      // A live phase can precede the track by a frame; there is nothing to
      // record yet and an empty recorder would write an empty file.
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

  // A capture is bound to the track it started on — MediaRecorder cannot be
  // re-pointed — so a retry that swaps in a new stream ends it. The track's
  // own `ended` covers the same ground, but can lag; whichever arrives first
  // wins and the finish path runs once.
  React.useEffect(() => {
    if (streamRef.current === stream) return;
    streamRef.current = stream;
    captureRef.current?.stop("source");
  }, [stream]);

  // Empty deps, reading a ref, on purpose: this must fire when the window
  // unmounts and never when it re-renders. A dep on `stream` or `capturing`
  // here would kill a live capture on the next frame.
  React.useEffect(() => () => captureRef.current?.stop("closed"), []);

  // The only thing that cannot be saved is a document that is going away: a
  // flush on `pagehide` would hand its blob to a page that no longer exists.
  // So ask instead, and only while there is something to lose — a clip is the
  // one unsaved artifact this console has ever held.
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
