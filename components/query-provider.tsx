"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * One QueryClient for the whole console, created in state rather than at module
 * scope so prerendered pages don't share one across server renders.
 *
 * - `retry: false`: every query polls or has a Refresh, so the next tick is the
 *   retry; the default backoff would hold "loading" ~5 s before an error shows.
 * - `refetchOnWindowFocus: false`: poll intervals are tuned (the active-task
 *   poll outwaits the backend's 1.5 s snapshot TTL, a schedule read is an RPC),
 *   so freshness is the interval's job.
 * - Mutations use `networkMode: "always"`. The default withholds a mutation
 *   while `navigator.onLine` is false, and a withheld one never settles — the
 *   button stays pending with no error. That flag says nothing about reaching
 *   a robot on a LAN, and is worst in the flow that drops the console's own
 *   link (useWifiConnect).
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
