import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorBody, errorDetail, requestJson, requestRaw } from "@/lib/api/http";

/**
 * The one door every backend read and write goes through. Three contracts are
 * load-bearing and all three are invisible to the type checker:
 *
 *  - a refusal reaches the operator as the backend's own sentence,
 *  - `Content-Type` is sent only with a body, because a GET that carries it
 *    leaves the CORS safelist and costs a preflight on every poll,
 *  - a response that does not match its schema is a loud error, not a silent
 *    `undefined` three components later.
 */

const URL_ = "http://robot.local:3000/api/v1/thing";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The RequestInit the code under test actually handed to fetch. */
function sentInit(): RequestInit & { headers: Headers } {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return { ...init, headers: new Headers(init.headers) };
}

describe("errorBody", () => {
  it("unwraps FastAPI's detail sentence", async () => {
    const body = await errorBody(
      jsonResponse({ detail: "Map 'dp2f' is in use." }, { status: 409 }),
    );
    expect(body).toEqual({ detail: "Map 'dp2f' is in use.", code: undefined });
  });

  it("keeps the machine-readable code beside the sentence", async () => {
    // Reading the body once is the whole reason this function exists: the two
    // endpoints that branch on `code` cannot unwrap the sentence first.
    const body = await errorBody(
      jsonResponse({ detail: "Hand edits present.", code: "gridmap_hand_edited" }, { status: 409 }),
    );
    expect(body).toEqual({
      detail: "Hand edits present.",
      code: "gridmap_hand_edited",
    });
  });

  it("stringifies a 422 validation array rather than dropping it", async () => {
    const body = await errorBody(
      jsonResponse({ detail: [{ loc: ["body", "theta"], msg: "bad" }] }, { status: 422 }),
    );
    expect(body.detail).toContain("theta");
  });

  it("falls back to the status line for a non-JSON body", async () => {
    const body = await errorBody(
      new Response("<html>502 from the proxy</html>", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    expect(body).toEqual({ detail: "502 Bad Gateway" });
  });

  it("errorDetail is the sentence half of the same read", async () => {
    expect(
      await errorDetail(jsonResponse({ detail: "no" }, { status: 400 })),
    ).toBe("no");
  });
});

describe("requestJson headers", () => {
  it("sends no Content-Type on a bodyless request", async () => {
    // A GET carrying it is cross-origin here and would cost an OPTIONS
    // preflight per poll.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson(URL_);
    expect(sentInit().headers.get("Content-Type")).toBeNull();
  });

  it("sends JSON when there is a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson(URL_, { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(sentInit().headers.get("Content-Type")).toBe("application/json");
  });

  it("lets an explicit Content-Type win", async () => {
    // The gridmap PUT ships a raw cell buffer; if this regressed the server
    // would try to parse ~1.6 MB of bytes as JSON.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson(URL_, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(sentInit().headers.get("Content-Type")).toBe(
      "application/octet-stream",
    );
  });

  it("keeps headers given as a Headers instance", async () => {
    // An object spread would silently drop these and send JSON instead.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await requestJson(URL_, {
      method: "POST",
      headers: new Headers({ "Content-Type": "text/plain", "X-Trace": "1" }),
      body: "hi",
    });
    const headers = sentInit().headers;
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect(headers.get("X-Trace")).toBe("1");
  });

  it("does not stringify a BufferSource body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const body = new Uint8Array([9, 8, 7]);
    await requestJson(URL_, { method: "PUT", body });
    expect(sentInit().body).toBe(body);
  });
});

describe("requestJson failures", () => {
  it("throws the backend's sentence, not the status code", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Switch the robot to another map first." }, { status: 409 }),
    );
    await expect(requestJson(URL_)).rejects.toThrow(
      "Switch the robot to another map first.",
    );
  });

  it("hands a refusal to mapError so it can become a typed error", async () => {
    class Conflict extends Error {
      constructor(
        message: string,
        readonly code: string,
      ) {
        super(message);
      }
    }
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "busy", code: "conversion_running" }, { status: 409 }),
    );
    await expect(
      requestJson(URL_, {
        mapError: ({ detail, code }, res) =>
          res.status === 409 && code ? new Conflict(detail, code) : undefined,
      }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it("falls through to a plain Error when mapError declines", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "plain" }, { status: 500 }),
    );
    const caught = await requestJson(URL_, { mapError: () => undefined }).catch(
      (e: unknown) => e,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).constructor).toBe(Error);
    expect((caught as Error).message).toBe("plain");
  });

  it("does not parse a body when parse is false", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      requestJson<void>(URL_, { method: "DELETE", parse: false }),
    ).resolves.toBeUndefined();
  });
});

describe("requestJson schema validation", () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  it("returns the parsed value and strips what the backend added", async () => {
    // A new field on the backend must not be a breaking change here.
    fetchMock.mockResolvedValue(
      jsonResponse({ name: "dp2f", count: 3, added_later: true }),
    );
    await expect(requestJson(URL_, { schema })).resolves.toEqual({
      name: "dp2f",
      count: 3,
    });
  });

  it("names the endpoint and the field when the shape is wrong", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "dp2f" }));
    const caught = await requestJson(URL_, { schema }).catch((e: unknown) => e);
    const message = (caught as Error).message;
    expect(message).toContain("/api/v1/thing");
    expect(message).toContain("count");
    // The host is noise in an operator-facing sentence.
    expect(message).not.toContain("robot.local");
  });

  it("rejects a renamed field rather than reading undefined", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "dp2f", total: 3 }));
    await expect(requestJson(URL_, { schema })).rejects.toThrow(/count/);
  });

  it("leaves an unvalidated read alone", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ anything: 1 }));
    await expect(requestJson(URL_)).resolves.toEqual({ anything: 1 });
  });
});

describe("requestRaw", () => {
  it("hands back the un-consumed response on success", async () => {
    // The gridmap image path depends on this: requestRaw must not read the
    // body, because decodeGrid wants it as a Blob.
    fetchMock.mockResolvedValue(new Response("PGM-BYTES", { status: 200 }));
    const res = await requestRaw(URL_);
    expect(res.bodyUsed).toBe(false);
    await expect((await res.blob()).text()).resolves.toBe("PGM-BYTES");
  });

  it("still surfaces the backend's sentence on a refusal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "no gridmap yet" }, { status: 404 }),
    );
    await expect(requestRaw(URL_)).rejects.toThrow("no gridmap yet");
  });

  it("sends no Content-Type", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 200 }));
    await requestRaw(URL_);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
  });
});
