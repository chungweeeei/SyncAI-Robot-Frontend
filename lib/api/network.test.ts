import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WifiBusyError,
  activateWifiConnection,
  connectWifi,
  forgetWifiConnection,
} from "@/lib/api/network";

/**
 * The robot changes its Wi-Fi one request at a time and refuses the rest with
 * 409 `wifi_busy`. The UI reads that as "wait", so each of the three writes
 * has to type it — on the code, never the sentence — and keep the sentence.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const BUSY = "The robot is already changing its WiFi connection; wait for that to finish.";

function answer(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const writes: [string, () => Promise<unknown>][] = [
  ["connect", () => connectWifi("lab-5g", "hunter22")],
  ["rejoin", () => activateWifiConnection("9a1e-lab")],
  ["forget", () => forgetWifiConnection("9a1e-lab")],
];

describe.each(writes)("%s", (_, write) => {
  it("types a busy refusal and keeps the backend's sentence", async () => {
    fetchMock.mockResolvedValue(answer({ detail: BUSY, code: "wifi_busy" }, 409));

    const failure = await write().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(WifiBusyError);
    expect((failure as Error).message).toBe(BUSY);
  });

  it("leaves every other refusal a plain error", async () => {
    fetchMock.mockResolvedValue(answer({ detail: "Wrong password" }, 400));

    const failure = await write().catch((cause: unknown) => cause);
    expect(failure).not.toBeInstanceOf(WifiBusyError);
    expect((failure as Error).message).toBe("Wrong password");
  });
});
