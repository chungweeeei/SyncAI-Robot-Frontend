// The operator's sign-in: the token the backend issued, kept in localStorage
// so a reload or a second tab stays signed in.
//
// Browser storage has two homes in this console, this and lib/task/draft-store.ts,
// and the same rules: the Storage is injected (the server has none, tests pass
// a Map), every access is wrapped because a private window or blocked site
// data must cost the session and not the page, and it is consumed through
// useSyncExternalStore (hooks/use-session.ts).
//
// It lives in lib/, not beside its hook, because lib/api/http.ts has to read
// the token on every request and drop it on a 401, and lib cannot reach hooks.

import * as z from "zod";

export interface Session {
  token: string;
  username: string;
  /** Epoch milliseconds, this machine's clock: when the token was handed over. */
  issuedAt: number;
  /** Epoch milliseconds: when the backend stops accepting the token. */
  expiresAt: number;
}

const SessionSchema: z.ZodType<Session> = z.object({
  token: z.string().min(1),
  username: z.string(),
  issuedAt: z.number(),
  expiresAt: z.number(),
});

/** The subset of the Storage API this store needs, so a test can pass a Map. */
export interface SessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface SessionStore {
  /** The current session, or null; the same object until it changes. */
  getSnapshot: () => Session | null;
  subscribe: (listener: () => void) => () => void;
  set: (session: Session) => void;
  /** Sign out. */
  clear: () => void;
  /**
   * Sign out only if `token` is still the session's: a refusal of a request
   * sent with an old token must not end the sign-in that replaced it.
   */
  clearIfToken: (token: string) => void;
  /** Re-read storage: another tab signed in or out. */
  reload: () => void;
}

export const SESSION_KEY = "auth.session";

export function isExpired(session: Session, now: number): boolean {
  return session.expiresAt <= now;
}

/** How long until the session ends, never below 0. */
export function msUntilExpiry(session: Session, now: number): number {
  return Math.max(0, session.expiresAt - now);
}

/**
 * How far into a token's life the console trades it for a fresh one. A
 * quarter of it left over is the margin a renewal has to land in, retries
 * included, before the expiry signs the operator out.
 */
export const RENEW_AT_FRACTION = 0.75;

/** How long after a renewal that did not land the console tries again. */
export const RENEW_RETRY_MS = 30_000;

/**
 * How long until the console should renew `session`, never below 0.
 *
 * An open console renews rather than signing out at the expiry: the
 * emergency stop is behind the sign-in, and an operator watching a patrol
 * for an hour presses nothing and would lose it, along with the map
 * editor's unsaved edits. The robot caps how long one sign-in can be
 * renewed for, and answers 401 past it, which signs out as any 401 does.
 */
export function msUntilRenewal(session: Session, now: number): number {
  const lifetime = Math.max(0, session.expiresAt - session.issuedAt);
  return Math.max(0, session.issuedAt + lifetime * RENEW_AT_FRACTION - now);
}

/**
 * When to try again after a renewal that did not land — a dropped link, a
 * robot restarting — or null when the expiry comes first and the session
 * should simply end there. A 401 never gets here: http.ts ends the session
 * on it.
 */
export function retryRenewalIn(session: Session, now: number): number | null {
  const left = msUntilExpiry(session, now);
  return left > RENEW_RETRY_MS ? RENEW_RETRY_MS : null;
}

export function decodeSession(raw: string | null, now: number): Session | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = SessionSchema.safeParse(parsed);
  if (!result.success) return null;
  // A token kept from a visit an hour ago is no sign-in: reading it as one
  // would draw the console for a moment before the first 401 took it away.
  return isExpired(result.data, now) ? null : result.data;
}

export function createSessionStore(
  storage: SessionStorage | null,
  key: string = SESSION_KEY,
  now: () => number = Date.now,
): SessionStore {
  const listeners = new Set<() => void>();
  let snapshot: Session | null = decodeSession(read(), now());

  function read(): string | null {
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function write(session: Session | null): void {
    if (!storage) return;
    try {
      if (session) storage.setItem(key, JSON.stringify(session));
      else storage.removeItem(key);
    } catch {
      // The in-memory session still works; it just ends with the tab.
    }
  }

  function publish(next: Session | null): void {
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (session) => {
      write(session);
      publish(session);
    },
    clear: () => {
      write(null);
      publish(null);
    },
    clearIfToken: (token) => {
      if (snapshot?.token !== token) return;
      write(null);
      publish(null);
    },
    reload: () => {
      const next = decodeSession(read(), now());
      // Same token, same session: keep the object, or every reader re-renders.
      publish(next?.token === snapshot?.token ? snapshot : next);
    },
  };
}

let store: SessionStore | null = null;

/** One store per tab, created on first use. */
export function sessionStore(): SessionStore {
  if (store) return store;
  let storage: Storage | null = null;
  if (typeof window !== "undefined") {
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const created = createSessionStore(storage);
    // A sign-out in one tab signs every tab out; a sign-in, likewise, in.
    window.addEventListener("storage", (event) => {
      if (event.key === SESSION_KEY || event.key === null) created.reload();
    });
    store = created;
    return created;
  }
  // The server render: no storage, and nothing kept between requests.
  return createSessionStore(null);
}

/** The current token, for a request about to go out. */
export function currentToken(): string | null {
  return sessionStore().getSnapshot()?.token ?? null;
}

/**
 * `headers` with the operator's token added, for the requests that do not go
 * through lib/api/http.ts (WHEP/WHIP signalling, the WebRTC bench).
 */
export function withToken(headers?: HeadersInit): Headers {
  const out = new Headers(headers);
  const token = currentToken();
  if (token && !out.has("Authorization")) out.set("Authorization", `Bearer ${token}`);
  return out;
}

/** A refusal of a request sent with `token`: that sign-in is over. */
export function endSessionFor(token: string | null): void {
  if (token) sessionStore().clearIfToken(token);
}
