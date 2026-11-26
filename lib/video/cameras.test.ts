import { describe, expect, it } from "vitest";

import {
  carriesMedia,
  INITIAL_CAMERA_VIEW,
  otherCamera,
  shownView,
  type CameraFeed,
} from "@/lib/video/cameras";

const stream = {} as MediaStream;
const FRONT: CameraFeed = { id: "front", stream };
const REAR: CameraFeed = { id: "rear", stream };

describe("carriesMedia", () => {
  it("counts a second camera only where the answer gave its line media", () => {
    // A robot with one camera answers the second video line inactive, and an
    // answer that never negotiated it leaves null: neither is a rear camera.
    expect(carriesMedia("recvonly")).toBe(true);
    expect(carriesMedia("sendrecv")).toBe(true);
    expect(carriesMedia("inactive")).toBe(false);
    expect(carriesMedia(null)).toBe(false);
    expect(carriesMedia(undefined)).toBe(false);
  });
});

describe("shownView", () => {
  it("opens on the front camera alone", () => {
    expect(shownView(INITIAL_CAMERA_VIEW, [FRONT, REAR])).toEqual({
      main: "front",
      pip: false,
    });
  });

  it("keeps the operator's choice while both cameras are there", () => {
    const view = { main: "rear", pip: true } as const;
    expect(shownView(view, [FRONT, REAR])).toBe(view);
  });

  it("falls back to the front camera, without an inset, when the rear one is gone", () => {
    // A retry on a robot that came back with one camera must not leave the
    // window on a picture that no longer exists.
    expect(shownView({ main: "rear", pip: true }, [FRONT])).toEqual({
      main: "front",
      pip: false,
    });
  });

  it("draws no inset with one camera", () => {
    expect(shownView({ main: "front", pip: true }, [FRONT])).toEqual({
      main: "front",
      pip: false,
    });
  });

  it("swaps to the other camera both ways", () => {
    expect(otherCamera("front")).toBe("rear");
    expect(otherCamera("rear")).toBe("front");
  });
});
