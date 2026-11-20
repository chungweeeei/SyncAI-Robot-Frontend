"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { login, refreshSession, type Credentials } from "@/lib/api/auth";
import { sessionStore, type Session } from "@/lib/auth/session";

const serverSnapshot = () => null;

/**
 * Who is signed in, as a subscription: null on the server and through
 * hydration, the kept session from the first client render after it. See
 * lib/auth/session.ts.
 */
export function useSession(): Session | null {
  const store = sessionStore();
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}

/** Sign out: the console's gate sees the session go and returns to /login. */
export function signOut(): void {
  sessionStore().clear();
}

/**
 * Sign in. A command, not a cached read: nothing to invalidate, the session
 * store is where the answer goes.
 */
export function useLogin() {
  return useMutation({
    mutationFn: (credentials: Credentials) => login(credentials),
    onSuccess: (session) => sessionStore().set(session),
  });
}

/**
 * Renew the session before it expires. A command like the sign-in: the
 * answer goes to the session store, which every tab and the next socket
 * connect read the new token from.
 */
export function useRenewSession() {
  return useMutation({
    mutationFn: (username: string) => refreshSession(username),
    onSuccess: (session) => sessionStore().set(session),
  });
}
