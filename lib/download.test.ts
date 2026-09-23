import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadBlob } from "@/lib/download";

/**
 * The rule these pin is not "it calls the DOM": it is that the file survives
 * the two ways this path is easy to get wrong — an anchor the browser ignores,
 * and a URL revoked out from under the transfer it was created for.
 */
describe("downloadBlob", () => {
  const created: string[] = [];
  const revoked: string[] = [];
  /** What the document held at the moment click() fired. */
  let clicked: { download: string; href: string; connected: boolean } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    created.length = 0;
    revoked.length = 0;
    clicked = null;

    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => {
        const url = `blob:test/${n++}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
    });

    // jsdom has no download manager, so a real click would navigate. The spy
    // snapshots the document at click time rather than afterwards, because the
    // caller removes the anchor immediately and what matters is what the
    // browser would have seen while the click was being handled.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      const anchor = document.querySelector<HTMLAnchorElement>("a[download]");
      clicked = anchor && {
        download: anchor.download,
        href: anchor.href,
        connected: anchor.isConnected,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clicks an anchor that is in the document and names the file", () => {
    downloadBlob(new Blob(["x"]), "camera-clip-20260923T140533Z.mp4");

    expect(clicked).toEqual({
      download: "camera-clip-20260923T140533Z.mp4",
      href: created[0],
      // Attached: Firefox does nothing at all with a detached anchor's click.
      connected: true,
    });
  });

  it("revokes the url it created, and not before the click", () => {
    downloadBlob(new Blob(["x"]), "clip.mp4");

    // The transfer has started; revoking here would be revoking under it.
    expect(revoked).toEqual([]);

    vi.advanceTimersByTime(1_000);
    expect(revoked).toEqual([created[0]]);
  });

  it("leaves nothing behind in the document", () => {
    downloadBlob(new Blob(["x"]), "clip.mp4");

    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });
});
