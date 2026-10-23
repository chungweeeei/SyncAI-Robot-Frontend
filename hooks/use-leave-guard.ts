"use client";

import * as React from "react";

/**
 * Ask before a reload or a tab close while `active`. That is all a page can
 * ask about: the App Router cannot block in-app navigation, so a screen with
 * work to lose guards its own back button as well.
 */
export function useLeaveGuard(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [active]);
}
