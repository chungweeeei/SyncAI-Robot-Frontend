import { describe, expect, it, vi } from "vitest";

import {
  createSessionStore,
  decodeSession,
  msUntilExpiry,
  msUntilRenewal,
  retryRenewalIn,
  type Session,
  type SessionStorage,
} from "@/lib/auth/session";

const NOW = 1_800_000_000_000;
const session = (over: Partial<Session> = {}): Session => ({
  token: "t1",
  username: "admin",
  issuedAt: NOW,
  expiresAt: NOW + 3_600_000,
  ...over,
});

function mapStorage(initial: Record<string, string> = {}): SessionStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("decodeSession", () => {
  it("reads a kept session back", () => {
    expect(decodeSession(JSON.stringify(session()), NOW)).toEqual(session());
  });

  it("is no sign-in once expired, so a stale tab does not draw the console first", () => {
    expect(decodeSession(JSON.stringify(session({ expiresAt: NOW })), NOW)).toBeNull();
  });

  it("is no sign-in for a value it cannot read", () => {
    expect(decodeSession("not json", NOW)).toBeNull();
    expect(decodeSession(JSON.stringify({ token: "" }), NOW)).toBeNull();
    expect(decodeSession(null, NOW)).toBeNull();
  });
});

describe("msUntilExpiry", () => {
  it("never goes below zero", () => {
    expect(msUntilExpiry(session({ expiresAt: NOW - 5 }), NOW)).toBe(0);
    expect(msUntilExpiry(session(), NOW)).toBe(3_600_000);
  });
});

describe("createSessionStore", () => {
  it("keeps a sign-in across a reload", () => {
    const storage = mapStorage();
    createSessionStore(storage, "k", () => NOW).set(session());
    expect(createSessionStore(storage, "k", () => NOW).getSnapshot()).toEqual(session());
  });

  it("forgets the token on sign-out and tells its readers", () => {
    const storage = mapStorage();
    const store = createSessionStore(storage, "k", () => NOW);
    store.set(session());
    const listener = vi.fn();
    store.subscribe(listener);
    store.clear();
    expect(store.getSnapshot()).toBeNull();
    expect(storage.data.has("k")).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not let a refusal of an old token end the sign-in that replaced it", () => {
    const store = createSessionStore(mapStorage(), "k", () => NOW);
    store.set(session({ token: "new" }));
    store.clearIfToken("old");
    expect(store.getSnapshot()?.token).toBe("new");
    store.clearIfToken("new");
    expect(store.getSnapshot()).toBeNull();
  });

  it("follows another tab's sign-out on reload, and keeps its object when nothing changed", () => {
    const storage = mapStorage();
    const store = createSessionStore(storage, "k", () => NOW);
    store.set(session());
    const before = store.getSnapshot();
    store.reload();
    expect(store.getSnapshot()).toBe(before);
    storage.data.delete("k");
    store.reload();
    expect(store.getSnapshot()).toBeNull();
  });

  it("costs the persistence, not the page, when storage throws", () => {
    const broken: SessionStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createSessionStore(broken, "k", () => NOW);
    expect(store.getSnapshot()).toBeNull();
    store.set(session());
    expect(store.getSnapshot()).toEqual(session());
    store.clear();
    expect(store.getSnapshot()).toBeNull();
  });
});

describe("msUntilRenewal", () => {
  it("renews a quarter of the way short of the expiry, so a retry still lands in time", () => {
    expect(msUntilRenewal(session(), NOW)).toBe(2_700_000);
    expect(msUntilRenewal(session(), NOW + 2_700_000)).toBe(0);
  });

  it("always comes before the expiry, whatever the token's life", () => {
    for (const life of [60_000, 600_000, 3_600_000, 86_400_000]) {
      const s = session({ expiresAt: NOW + life });
      expect(msUntilRenewal(s, NOW)).toBeLessThan(msUntilExpiry(s, NOW));
    }
  });

  it("is due at once for a session already past its renewal point", () => {
    expect(msUntilRenewal(session(), NOW + 3_000_000)).toBe(0);
  });
});

describe("retryRenewalIn", () => {
  it("tries again after a renewal that did not land, while there is time", () => {
    expect(retryRenewalIn(session(), NOW + 2_700_000)).toBe(30_000);
  });

  it("stops retrying once the expiry would come first, and lets it end the session", () => {
    expect(retryRenewalIn(session(), NOW + 3_590_000)).toBeNull();
  });
});
