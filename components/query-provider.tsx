"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * One QueryClient for the whole console.
 *
 * Created in state rather than at module scope: these pages are prerendered,
 * and a module-level client would be shared across server renders — per-mount
 * state is the shape the TanStack SSR guide prescribes.
 *
 * Two defaults deviate from the library, both to keep the semantics the
 * hand-rolled fetch hooks had before the migration:
 *
 * - `retry: false`. Every query here is either on a poll interval (the next
 *   tick *is* the retry) or has an explicit Refresh escape hatch. The default
 *   three exponential retries would hold "loading" for ~5 s before the
 *   console's error tone appears, and the status indicators exist precisely to
 *   report a failure the moment it happens.
 * - `refetchOnWindowFocus: false`. The poll economics are deliberate —
 *   useActiveTasks outwaits the backend's 1.5 s snapshot TTL on purpose, and
 *   the schedules list costs a Temporal RPC per read — so freshness is the
 *   interval's job, not the window manager's.
 *
 * Mutations get `networkMode: "always"`, which is not a preference but a
 * correctness requirement here. The library default withholds a mutation while
 * `navigator.onLine` is false, and a withheld one never settles: `isPending`
 * stays true, so the button that started it stays disabled with no error to
 * explain why. That flag answers "is there any network interface up", not "can
 * this page reach the robot" — the wrong question for a console that talks to a
 * machine on a LAN, and worst in exactly the flow that drops the console's own
 * link (useWifiConnect). Failing fast is what every one of these hooks did
 * before it was a mutation, and what their "a dropped connection means the
 * command is working" logic is written against.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
          mutations: { networkMode: "always" },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
