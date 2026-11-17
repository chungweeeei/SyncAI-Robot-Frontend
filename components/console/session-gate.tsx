"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { useMounted } from "@/hooks/use-mounted";
import { useSession } from "@/hooks/use-session";
import { loginHref } from "@/lib/auth/next-path";
import { msUntilExpiry, sessionStore } from "@/lib/auth/session";

/** setTimeout's ceiling (2^31 - 1 ms); a longer delay fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * The console behind the sign-in. Its children — the polls, the shell, every
 * screen — mount only while there is a session, so a signed-out console asks
 * the robot nothing and holds no socket open.
 *
 * A session ends three ways, and all three are the store emptying: the
 * operator's Sign out, any request answered 401 (lib/api/http.ts, which is
 * also how a backend restarted with a new key signs everyone out), and the
 * timer below at the token's expiry, so an idle console does not sit on a
 * screen whose next press would be refused. Another tab's sign-out arrives
 * through the storage event. Whichever it was, this sends the operator to
 * /login, remembering the screen, and drops every cached read: what the
 * robot said to the last operator is not this one's to see.
 *
 * Blank until mounted: the server has no session to render with, and a
 * redirect from the hydrating render would bounce a signed-in reload.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => sessionStore().clearIfToken(session.token),
      Math.min(msUntilExpiry(session, Date.now()), MAX_TIMER_MS),
    );
    return () => clearTimeout(timer);
  }, [session]);

  React.useEffect(() => {
    if (!mounted || session) return;
    queryClient.clear();
    // The query too: a filter or a map name in it is part of the screen.
    router.replace(loginHref(`${pathname}${window.location.search}`));
  }, [mounted, session, pathname, queryClient, router]);

  if (!mounted || !session) {
    return <div aria-hidden className="h-dvh bg-background" />;
  }
  return children;
}
