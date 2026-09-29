import { describe, expect, it } from "vitest";

import { RESTART_GIVE_UP_MS, restartPending } from "@/lib/robot/restart";

/**
 * The restart is over only once the link has dropped *and* come back. A frame
 * after the press is not enough on its own: the old stack keeps answering for
 * up to the backend's ack window before it goes down.
 */
describe("restartPending", () => {
  const at = 1_000_000;

  it("is not pending when nothing was requested", () => {
    expect(
      restartPending({ requestedAt: null, updatedAt: at, lastErrorAt: at }),
    ).toBe(false);
  });

  it("stays pending on a frame that arrives before the link drops", () => {
    expect(
      restartPending({ requestedAt: at, updatedAt: at + 1000, lastErrorAt: null }),
    ).toBe(true);
  });

  it("does not count a failure from before the press as the drop", () => {
    expect(
      restartPending({
        requestedAt: at,
        updatedAt: at + 1000,
        lastErrorAt: at - 5000,
      }),
    ).toBe(true);
  });

  it("stays pending while the link is down", () => {
    expect(
      restartPending({
        requestedAt: at,
        updatedAt: at + 1000,
        lastErrorAt: at + 20_000,
      }),
    ).toBe(true);
  });

  it("is over on the first frame after the drop", () => {
    expect(
      restartPending({
        requestedAt: at,
        updatedAt: at + 21_000,
        lastErrorAt: at + 20_000,
      }),
    ).toBe(false);
  });

  it("gives up when the link never drops", () => {
    expect(
      restartPending({
        requestedAt: at,
        updatedAt: at + RESTART_GIVE_UP_MS - 1,
        lastErrorAt: null,
      }),
    ).toBe(true);
    expect(
      restartPending({
        requestedAt: at,
        updatedAt: at + RESTART_GIVE_UP_MS,
        lastErrorAt: null,
      }),
    ).toBe(false);
  });
});
