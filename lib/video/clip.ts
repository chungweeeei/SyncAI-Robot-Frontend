import { downloadBlob } from "@/lib/download";

/**
 * Saving a clip of the camera's picture to the operator's own machine; the
 * robot never sees it.
 *
 * **It re-encodes** decoded frames rather than keeping the wire's H.264:
 * keeping it would mean muxing encoded frames by hand, Chromium only. Fine for
 * showing someone what the robot saw.
 *
 * **The capture outlives its caller.** The handle owns its recorder, chunks
 * and delivery, so closing the camera window still lands the file. Moving the
 * chunks into component state would lose a capture on Escape.
 */

export interface ClipFormat {
  readonly mimeType: string;
  /** The chosen type's own subtype — see pickClipFormat. */
  readonly extension: string;
}

/**
 * Best first. MP4/H.264 plays on a double-click in Windows Photos and
 * QuickTime; WebM is for Firefox, which writes no MP4.
 */
export const CLIP_MIME_CANDIDATES: readonly string[] = [
  // Constrained baseline level 3.0 — the profile every player has.
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** One chunk a second: it bounds each allocation and paces the readout. */
export const CLIP_TIMESLICE_MS = 1_000;
/** Then the clip saves itself: a clip is a "look at this", not a log. */
export const CLIP_MAX_MS = 10 * 60 * 1_000;
/**
 * The net under the clock (ten minutes is ~190 MiB at the bitrate below), for
 * an encoder that ignores the hint — the alternative is a tab that dies.
 */
export const CLIP_MAX_BYTES = 512 * 1024 * 1024;
/** A hint, so the byte cap maps to a predictable duration. */
export const CLIP_VIDEO_BITS_PER_SECOND = 2_500_000;

/** Why a capture ended; each is a different sentence on screen. */
export type ClipEnd =
  | "operator"
  /** A cap was reached; the clip was saved, not dropped. */
  | "limit"
  /** The picture went away (session dropped, or a retry replaced it). */
  | "source"
  /** The window was closed mid-capture. */
  | "closed"
  | "error";

export interface ClipProgress {
  elapsedMs: number;
  bytes: number;
}

export interface ClipOutcome {
  end: ClipEnd;
  elapsedMs: number;
  bytes: number;
  /** Null when nothing was written: an empty file is never delivered. */
  filename: string | null;
  /** Set only for `end: "error"`. */
  error: string | null;
}

export interface ClipCapture {
  readonly filename: string;
  /**
   * Idempotent; the first call decides the outcome. A dead track makes the UA
   * finish on its own, so every stop path must tolerate arriving second.
   */
  stop: (end?: ClipEnd) => void;
}

export interface ClipCaptureOptions {
  onProgress?: (progress: ClipProgress) => void;
  onFinish?: (outcome: ClipOutcome) => void;
  // Test seams.
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  deliver?: (blob: Blob, filename: string) => void;
  now?: () => number;
}

/**
 * The first candidate this browser will write, or null rather than a guess.
 * The extension is derived from the type, so the name cannot disagree with
 * the bytes. Safe during a prerender, where MediaRecorder does not exist.
 */
export function pickClipFormat(
  isSupported?: (type: string) => boolean,
): ClipFormat | null {
  const supported =
    isSupported ??
    (typeof MediaRecorder === "undefined"
      ? null
      : (type: string) => MediaRecorder.isTypeSupported(type));
  if (!supported) return null;

  const mimeType = CLIP_MIME_CANDIDATES.find((type) => supported(type));
  if (!mimeType) return null;

  return { mimeType, extension: mimeType.split(";")[0].split("/")[1] };
}

/**
 * `camera-clip-20260923T140533Z.mp4`: UTC basic ISO 8601, so no colons
 * (Windows refuses them), no locale, and lexical order is chronological.
 */
export function clipFilename(startedAt: Date, extension: string): string {
  const stamp = startedAt.toISOString().slice(0, 19).replace(/[-:]/g, "");
  return `camera-clip-${stamp}Z.${extension}`;
}

/**
 * Start writing the stream's video into a file. Null without a video track
 * yet: `phase === "live"` can precede the track event by a frame.
 */
export function startClipCapture(
  source: MediaStream,
  format: ClipFormat,
  options: ClipCaptureOptions = {},
): ClipCapture | null {
  const {
    onProgress,
    onFinish,
    createRecorder = (stream, init) => new MediaRecorder(stream, init),
    deliver = downloadBlob,
    now = () => Date.now(),
  } = options;

  const track = source.getVideoTracks()[0];
  if (!track) return null;

  // Video only, structurally: the audio track is the robot's microphone in a
  // room with people, and "save what the camera sees" does not mean them.
  const videoOnly = new MediaStream([track]);

  const startedAt = new Date(now());
  const startedMs = now();
  const filename = clipFilename(startedAt, format.extension);

  const chunks: Blob[] = [];
  let bytes = 0;
  let elapsedMs = 0;
  let end: ClipEnd = "operator";
  let error: string | null = null;
  let finished = false;

  let recorder: MediaRecorder;
  try {
    recorder = createRecorder(videoOnly, {
      mimeType: format.mimeType,
      videoBitsPerSecond: CLIP_VIDEO_BITS_PER_SECOND,
    });
  } catch (e) {
    onFinish?.({
      end: "error",
      elapsedMs: 0,
      bytes: 0,
      filename: null,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  /**
   * Runs once: the explicit stop and the UA's own (on track end) race on every
   * closed window, and delivering twice would download two copies.
   */
  const finish = () => {
    if (finished) return;
    finished = true;
    track.removeEventListener("ended", onTrackEnded);

    if (bytes > 0) deliver(new Blob(chunks, { type: format.mimeType }), filename);
    chunks.length = 0;

    onFinish?.({
      end,
      elapsedMs,
      bytes,
      filename: bytes > 0 ? filename : null,
      error,
    });
  };

  const stop = (reason: ClipEnd = "operator") => {
    if (finished) return;
    // Only the first stop names the outcome.
    if (end === "operator") end = reason;
    try {
      if (recorder.state !== "inactive") recorder.stop();
      else finish();
    } catch {
      // InvalidStateError: the UA got there first; finish() is idempotent.
      finish();
    }
  };

  function onTrackEnded() {
    stop("source");
  }

  recorder.addEventListener("dataavailable", (event: BlobEvent) => {
    if (event.data.size === 0) return;
    chunks.push(event.data);
    bytes += event.data.size;
    // Sampled when bytes arrive, not off a wall clock, so a stalled encoder
    // shows as a stalled readout.
    elapsedMs = now() - startedMs;
    onProgress?.({ elapsedMs, bytes });

    if (elapsedMs >= CLIP_MAX_MS || bytes >= CLIP_MAX_BYTES) stop("limit");
  });

  recorder.addEventListener("stop", finish);
  recorder.addEventListener("error", (event: Event) => {
    const detail = (event as { error?: { message?: string } }).error;
    end = "error";
    error = detail?.message ?? "The clip could not be saved.";
    stop("error");
  });

  track.addEventListener("ended", onTrackEnded);
  recorder.start(CLIP_TIMESLICE_MS);

  return { filename, stop };
}
