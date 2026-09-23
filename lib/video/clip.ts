import { downloadBlob } from "@/lib/download";

/**
 * Saving a clip of the camera's picture to the operator's own machine.
 *
 * The one artifact this console produces that the robot never sees: there is no
 * endpoint behind any of this, no cache to invalidate and nothing to fetch back.
 * It is a browser recording a track it is already receiving.
 *
 * **It re-encodes.** MediaRecorder does not repackage the H.264 arriving on the
 * wire; it encodes frames the decoder has already produced, so a clip is a
 * second-generation encode and costs the operator's laptop some CPU while it
 * runs. Keeping the original bitstream would mean intercepting encoded frames
 * and muxing them by hand — Chromium only, and a muxer to maintain. The picture
 * is for showing someone what the robot saw, so the cross-browser path wins.
 *
 * **The capture outlives its caller.** `startClipCapture` returns a handle that
 * owns its recorder, its chunks and its delivery, none of which are React's.
 * Closing the camera window unmounts the component and closes the session; the
 * handle is still held by the recorder's own listeners, so the file still
 * lands. Anything that moved the chunk buffer into component state would lose a
 * capture the moment the operator pressed Escape.
 */

/** A container this browser can actually write, and the extension that follows. */
export interface ClipFormat {
  readonly mimeType: string;
  /** Always the chosen type's own subtype — see pickClipFormat. */
  readonly extension: string;
}

/**
 * Best first.
 *
 * MP4/H.264 leads because of what happens after the download: the operator
 * double-clicks the file, and Windows Photos and QuickTime play MP4 without
 * being asked twice. WebM is the fallback Firefox needs, which writes no MP4 at
 * all; vp9 before vp8 for the bytes.
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
/** Ten minutes, then the clip saves itself. A clip is a "look at this", not a log. */
export const CLIP_MAX_MS = 10 * 60 * 1_000;
/**
 * The net under the clock. At the bitrate below ten minutes is ~190 MiB, so
 * this only fires for a source that ignores the hint — but when it does, the
 * alternative is a tab that dies holding the operator's clip.
 */
export const CLIP_MAX_BYTES = 512 * 1024 * 1024;
/**
 * Asked for, not guaranteed. Its job is to make the byte cap correspond to a
 * predictable duration instead of to whatever the encoder felt like.
 */
export const CLIP_VIDEO_BITS_PER_SECOND = 2_500_000;

/** Why a capture ended. Each one is a different sentence on screen. */
export type ClipEnd =
  /** The operator pressed stop. */
  | "operator"
  /** A cap was reached; the clip was saved, not dropped. */
  | "limit"
  /** The picture went away under it — session dropped, or a retry replaced it. */
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
   * Idempotent, and the first call decides the outcome. The recorder can finish
   * on its own — a dead track makes the UA flush — so every stop path has to
   * tolerate arriving second.
   */
  stop: (end?: ClipEnd) => void;
}

export interface ClipCaptureOptions {
  onProgress?: (progress: ClipProgress) => void;
  onFinish?: (outcome: ClipOutcome) => void;
  /** Test seam. Defaults to the real MediaRecorder. */
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  /** Test seam. Defaults to downloadBlob. */
  deliver?: (blob: Blob, filename: string) => void;
  /** Test seam. Defaults to Date.now. */
  now?: () => number;
}

/**
 * The first candidate this browser will write, or null when it will write none.
 *
 * The extension is derived from the chosen type rather than looked up beside
 * it, so the name can never disagree with the bytes — reordering or editing the
 * candidate list cannot desynchronise them.
 *
 * Null rather than a guess: a file the operator's machine cannot open is worse
 * than a button that says it cannot save. Safe to call during a prerender,
 * where MediaRecorder does not exist at all.
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
 * `camera-clip-20260923T140533Z.mp4`.
 *
 * UTC, basic ISO 8601: no colons, which Windows refuses in a filename and
 * Finder renders as a slash; no locale formatting, so the same instant names
 * the same file on a laptop in Taipei and one in Berlin; and lexical order is
 * chronological order in the operator's downloads folder.
 */
export function clipFilename(startedAt: Date, extension: string): string {
  const stamp = startedAt.toISOString().slice(0, 19).replace(/[-:]/g, "");
  return `camera-clip-${stamp}Z.${extension}`;
}

/**
 * Start writing the stream's video into a file.
 *
 * Null when there is no video track yet: `phase === "live"` can precede the
 * track event by a frame, and an empty recorder would produce a file with
 * nothing in it.
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

  // Video only, structurally: the recorder is handed a stream with one track,
  // so the container cannot end up with audio in it and there is no flag to
  // forget. The session's Opus track is the robot's microphone in a room with
  // people in it, and "save what the camera sees" does not mean recording them.
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
   * Runs exactly once, whichever path got here first. The UA flushes and fires
   * `stop` on its own when the track ends, so the explicit stop and the
   * automatic one race on every closed window — and delivering twice would put
   * two copies of the clip in the operator's downloads.
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
    // Only the first stop names the outcome: a cap that fires while the window
    // is closing should still read as the cap.
    if (end === "operator") end = reason;
    try {
      if (recorder.state !== "inactive") recorder.stop();
      else finish();
    } catch {
      // InvalidStateError — the UA got there first and `stop` is already on its
      // way, or has already run. Either way finish() is idempotent.
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
    // Sampled when bytes arrive rather than read off a wall clock, the same
    // rule the bag recorder's elapsed readout follows: a clock that keeps
    // ticking through a stalled encoder hides the one state the readout exists
    // to expose.
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
