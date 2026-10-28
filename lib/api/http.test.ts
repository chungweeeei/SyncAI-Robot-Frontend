import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { errorBody, errorDetail, readBlob, requestJson, requestRaw } from "@/lib/api/http";

/**
 * Three contracts the type checker cannot see: a refusal is the backend's own
 * sentence, `Content-Type` only with a body (CORS preflight), and a schema
 * mismatch is a loud error.
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
    // A body reads once, so sentence and `code` come out together.
    const body = await errorBody(
      jsonResponse({ detail: "A task still uses this map.", code: "template_bound" }, { status: 409 }),
    );
    expect(body).toEqual({
      detail: "A task still uses this map.",
      code: "template_bound",
    });
  });

  it("keeps the step a refusal names, for the editor to mark", async () => {
    const body = await errorBody(
      jsonResponse(
        { detail: "Group 'g1' has more than one…", code: "invalid_step_group", step_id: "2-standup" },
        { status: 400 },
      ),
    );
    expect(body).toMatchObject({ code: "invalid_step_group", stepId: "2-standup" });
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
    // A GET carrying it would cost a CORS preflight per poll.
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
    // The map import ships raw bytes the server must not parse as JSON.
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

  it("hands the caller's signal to fetch", async () => {
    // An import's Cancel only works if the signal reaches fetch.
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const { signal } = new AbortController();
    await requestJson(URL_, { method: "POST", body: "x", signal });
    expect(sentInit().signal).toBe(signal);
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
      jsonResponse({ detail: "busy", code: "task_running" }, { status: 409 }),
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

  it("tells the operator a write already happened when its answer is unreadable", async () => {
    // A 2xx means the robot acted; a Retry would do it twice.
    fetchMock.mockResolvedValue(jsonResponse({ name: "dp2f" }));
    await expect(
      requestJson(URL_, { method: "POST", body: "{}", schema }),
    ).rejects.toThrow(/accepted the request/);
  });

  it("does not say a read was accepted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "dp2f" }));
    const caught = await requestJson(URL_, { schema }).catch((e: unknown) => e);
    expect((caught as Error).message).not.toMatch(/accepted/);
  });

  it("leaves an unvalidated read alone", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ anything: 1 }));
    await expect(requestJson(URL_)).resolves.toEqual({ anything: 1 });
  });
});

describe("requestRaw", () => {
  it("hands back the un-consumed response on success", async () => {
    // decodeGrid wants the body unread, as a Blob.
    fetchMock.mockResolvedValue(new Response("PGM-BYTES", { status: 200 }));
    const res = await requestRaw(URL_);
    expect(res.bodyUsed).toBe(false);
    await expect((await res.blob()).text()).resolves.toBe("PGM-BYTES");
  });

  it("still surfaces the backend's sentence on a refusal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "no 3D map yet" }, { status: 404 }),
    );
    await expect(requestRaw(URL_)).rejects.toThrow("no 3D map yet");
  });

  it("sends no Content-Type", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 200 }));
    await requestRaw(URL_);
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
  });
});

describe("readBlob", () => {
  /** A body that arrives in the given pieces, as a slow download does. */
  function streamed(pieces: number[], headers: Record<string, string>) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of pieces) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    return new Response(body, { headers });
  }

  it("reports the share arrived against the declared length, ending at 1", async () => {
    const seen: number[] = [];
    const blob = await readBlob(
      streamed([25, 25, 50], { "Content-Length": "100", "Content-Type": "application/zip" }),
      (fraction) => seen.push(fraction),
    );

    expect(seen).toEqual([0, 0.25, 0.5, 1]);
    expect(blob.size).toBe(100);
    expect(blob.type).toBe("application/zip");
  });

  it("reports nothing without a declared length, rather than a guessed fraction", async () => {
    const onProgress = vi.fn();
    const blob = await readBlob(streamed([10, 10], {}), onProgress);

    expect(onProgress).not.toHaveBeenCalled();
    expect(blob.size).toBe(20);
  });
});
