import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Far from UTC on purpose: clipFilename must name the same instant the same
// file everywhere, so an implementation that reached for a locale formatter
// fails here rather than in Berlin. ESM hoists the imports above this line,
// which is harmless — nothing reads a Date until a test runs.
process.env.TZ = "Asia/Taipei";

import {
  CLIP_MAX_BYTES,
  CLIP_MAX_MS,
  CLIP_MIME_CANDIDATES,
  clipFilename,
  pickClipFormat,
  startClipCapture,
  type ClipOutcome,
} from "@/lib/video/clip";

/** A track the test can end under a running capture. */
class FakeTrack extends EventTarget {
  constructor(readonly kind: "video" | "audio") {
    super();
  }
  end() {
    this.dispatchEvent(new Event("ended"));
  }
}

class FakeStream {
  constructor(private readonly tracks: FakeTrack[]) {}
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

/**
 * Enough MediaRecorder to drive every path: jsdom has none, and the real one
 * would need a real encoder and real frames to say anything.
 */
class FakeRecorder extends EventTarget {
  state: "inactive" | "recording" | "paused" = "inactive";
  timeslice: number | undefined;
  constructor(
    readonly stream: FakeStream,
    readonly options: MediaRecorderOptions,
  ) {
    super();
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
  /** One `dataavailable`, `size` bytes of it. */
  emit(size: number) {
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = new Blob(["x".repeat(size)]);
    this.dispatchEvent(event);
  }
  /** A chunk whose size is claimed rather than allocated. */
  emitClaiming(size: number) {
    const event = new Event("dataavailable") as Event & { data: Blob };
    event.data = { size } as Blob;
    this.dispatchEvent(event);
  }
}

const MP4: { mimeType: string; extension: string } = {
  mimeType: "video/mp4;codecs=avc1.42E01E",
  extension: "mp4",
};

/** Wire a capture up to fakes and hand back everything the test needs. */
function capture(
  source: FakeStream,
  over: { now?: () => number } = {},
) {
  let recorder!: FakeRecorder;
  const delivered: { blob: Blob; filename: string }[] = [];
  const outcomes: ClipOutcome[] = [];

  const handle = startClipCapture(source as unknown as MediaStream, MP4, {
    createRecorder: (stream, options) => {
      recorder = new FakeRecorder(
        stream as unknown as FakeStream,
        options,
      );
      return recorder as unknown as MediaRecorder;
    },
    deliver: (blob, filename) => delivered.push({ blob, filename }),
    onFinish: (outcome) => outcomes.push(outcome),
    ...over,
  });

  return { handle, recorder, delivered, outcomes };
}

describe("pickClipFormat", () => {
  it("prefers a file the operator's machine opens by double-clicking", () => {
    const format = pickClipFormat(() => true);
    expect(format?.mimeType).toBe("video/mp4;codecs=avc1.42E01E");
  });

  it("still saves a clip on a browser that writes no mp4", () => {
    const noMp4 = pickClipFormat((type) => !type.startsWith("video/mp4"));
    expect(noMp4?.mimeType).toBe("video/webm;codecs=vp9");

    const oldFirefox = pickClipFormat((type) => type === "video/webm;codecs=vp8");
    expect(oldFirefox?.mimeType).toBe("video/webm;codecs=vp8");
  });

  it("refuses rather than naming a file nobody can open", () => {
    expect(pickClipFormat(() => false)).toBeNull();
  });

  it("answers null where MediaRecorder does not exist, without throwing", () => {
    // The prerender: this module is imported by a client component Next still
    // renders on the server.
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickClipFormat()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("never lets the extension disagree with what was written", () => {
    for (const candidate of CLIP_MIME_CANDIDATES) {
      const format = pickClipFormat((type) => type === candidate);
      expect(format?.extension).toBe(candidate.split(";")[0].split("/")[1]);
    }
  });
});

describe("clipFilename", () => {
  it("names the same instant the same file in every timezone", () => {
    // 22:05 local in the timezone this file runs under, 14:05 UTC in the name.
    expect(clipFilename(new Date("2026-09-23T14:05:33.000Z"), "mp4")).toBe(
      "camera-clip-20260923T140533Z.mp4",
    );
  });

  it("writes no character a filesystem will refuse", () => {
    const name = clipFilename(new Date("2026-01-02T03:04:05.000Z"), "webm");
    expect(name).not.toContain(":");
    expect(name.endsWith(".webm")).toBe(true);
  });
});

describe("startClipCapture", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "MediaStream",
      class {
        constructor(private readonly tracks: FakeTrack[]) {}
        getVideoTracks() {
          return this.tracks.filter((t) => t.kind === "video");
        }
        getAudioTracks() {
          return this.tracks.filter((t) => t.kind === "audio");
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("records the picture and not the room", () => {
    const source = new FakeStream([new FakeTrack("video"), new FakeTrack("audio")]);
    const { recorder } = capture(source);

    expect(recorder.stream.getVideoTracks()).toHaveLength(1);
    expect(recorder.stream.getAudioTracks()).toHaveLength(0);
  });

  it("has nothing to save before the picture arrives", () => {
    const { handle, delivered } = capture(new FakeStream([]));

    expect(handle).toBeNull();
    expect(delivered).toEqual([]);
  });

  it("counts the bytes it actually wrote", () => {
    const { handle, recorder, delivered, outcomes } = capture(
      new FakeStream([new FakeTrack("video")]),
    );
    recorder.emit(4);
    recorder.emit(6);
    handle!.stop();

    expect(outcomes[0].bytes).toBe(10);
    expect(delivered[0].blob.size).toBe(10);
    expect(delivered[0].filename).toBe(handle!.filename);
  });

  it("saves the clip when it hits the size cap rather than dropping it", () => {
    const { recorder, delivered, outcomes } = capture(
      new FakeStream([new FakeTrack("video")]),
    );
    recorder.emitClaiming(CLIP_MAX_BYTES);

    expect(outcomes[0].end).toBe("limit");
    expect(outcomes[0].filename).not.toBeNull();
    expect(delivered).toHaveLength(1);
  });

  it("saves the clip when it hits the ten-minute cap", () => {
    let clock = 0;
    const { recorder, delivered, outcomes } = capture(
      new FakeStream([new FakeTrack("video")]),
      { now: () => clock },
    );

    clock = CLIP_MAX_MS - 1_000;
    recorder.emit(4);
    expect(outcomes).toEqual([]);

    clock = CLIP_MAX_MS;
    recorder.emit(4);
    expect(outcomes[0].end).toBe("limit");
    expect(delivered).toHaveLength(1);
  });

  it("saves what it has when the picture goes away under it", () => {
    const track = new FakeTrack("video");
    const { recorder, delivered, outcomes } = capture(new FakeStream([track]));
    recorder.emit(4);
    track.end();

    expect(outcomes[0].end).toBe("source");
    expect(delivered).toHaveLength(1);
  });

  it("delivers once however many times it is stopped", () => {
    // The window closing stops it explicitly while the ended track has the UA
    // flushing it too. Two copies in the downloads folder would be the bug.
    const track = new FakeTrack("video");
    const { handle, recorder, delivered, outcomes } = capture(new FakeStream([track]));
    recorder.emit(4);

    handle!.stop("closed");
    track.end();
    handle!.stop();

    expect(delivered).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].end).toBe("closed");
  });

  it("hands over no empty file", () => {
    const { handle, delivered, outcomes } = capture(
      new FakeStream([new FakeTrack("video")]),
    );
    handle!.stop();

    expect(delivered).toEqual([]);
    expect(outcomes[0].filename).toBeNull();
  });

  it("asks for chunks rather than one blob at the end", () => {
    // Without a timeslice the whole clip arrives in a single dataavailable at
    // stop, which is both one huge allocation and a readout that never ticks.
    const { recorder } = capture(new FakeStream([new FakeTrack("video")]));
    expect(recorder.timeslice).toBe(1_000);
  });
});
