import { afterEach, describe, expect, it, vi } from "vitest";

import { openSession } from "@/lib/video/signalling";

/**
 * The handshake every camera and microphone session goes through. What it has
 * to keep is the teardown: a robot whose camera or speaker is left claimed
 * refuses the next console, and a microphone left live keeps the browser's
 * recording light on.
 */

function fakePeer() {
  const calls: string[] = [];
  const pc = {
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0 offer+candidates" },
    connectionState: "new",
    iceConnectionState: "new",
    addEventListener: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {
      calls.push("answer");
    }),
    close: vi.fn(() => {
      calls.push("pc.close");
    }),
  };
  return { pc: pc as unknown as RTCPeerConnection, calls };
}

function answerWith(response: Response, calls: string[]) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    return init?.method === "DELETE" ? new Response(null, { status: 204 }) : response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("openSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts the gathered offer, and on close deletes the session before closing the peer", async () => {
    const { pc, calls } = fakePeer();
    const fetch = answerWith(
      new Response("v=0 answer", { status: 201, headers: { Location: "/sessions/abc" } }),
      calls,
    );

    const session = await openSession(pc, "/api/v1/webrtc/whep", {});
    const [, post] = fetch.mock.calls[0];
    // The candidates ride in the offer: there is no trickle to send them later.
    expect(post?.body).toBe("v=0 offer+candidates");
    expect(session.sessionUrl).toMatch(/\/sessions\/abc$/);

    await session.close();
    await session.close();
    expect(calls.filter((call) => call.startsWith("DELETE"))).toHaveLength(1);
    expect(calls.indexOf("pc.close")).toBeGreaterThan(
      calls.findIndex((call) => call.startsWith("DELETE")),
    );
  });

  it("releases the microphone and closes the peer when the robot refuses the offer", async () => {
    const { pc, calls } = fakePeer();
    answerWith(new Response(JSON.stringify({ detail: "The camera is in use." }), { status: 409 }), calls);
    const release = vi.fn();

    await expect(openSession(pc, "/api/v1/webrtc/whip", { release })).rejects.toThrow(
      "The camera is in use.",
    );
    expect(release).toHaveBeenCalledOnce();
    expect(pc.close).toHaveBeenCalledOnce();
    // Nothing was created on the robot, so there is nothing to delete.
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });

  it("releases the microphone when setting up the transceivers throws", async () => {
    const { pc, calls } = fakePeer();
    const fetch = answerWith(new Response("v=0 answer", { status: 201 }), calls);
    const release = vi.fn();

    await expect(
      openSession(pc, "/api/v1/webrtc/duplex", {
        setup: () => {
          throw new Error("getUserMedia returned no audio track");
        },
        release,
      }),
    ).rejects.toThrow("no audio track");
    expect(release).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
