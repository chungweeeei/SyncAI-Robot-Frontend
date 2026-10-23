"use client";

import "./globals.css";

import { FaultPanel } from "@/components/console/fault-panel";

/**
 * The last resort, for a throw in the root layout itself. It replaces the
 * layout, so the emergency stop is gone with it — which is why the strip's
 * panels each carry their own FaultBoundary and should never reach here.
 */
export default function GlobalError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="h-dvh bg-background text-foreground">
        <title>SyncAI Robot Console</title>
        <FaultPanel
          title="The console stopped working"
          detail="The emergency stop is not available on this screen. Try again, or reload the page."
          onRetry={unstable_retry}
        />
      </body>
    </html>
  );
}
