"use client";

import { FaultPanel } from "@/components/console/fault-panel";

/**
 * Every route's boundary. It sits inside the root layout, so the nav rail and
 * the status strip — and with it the emergency stop — stay mounted while a
 * screen has failed.
 */
export default function RouteError({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <FaultPanel
      title="This screen stopped working"
      detail="The emergency stop and the rest of the console still work. Try again, or open another screen from the menu."
      onRetry={unstable_retry}
    />
  );
}
