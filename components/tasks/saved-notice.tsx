"use client";

import * as React from "react";
import { CheckIcon, XIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";

/** Long enough to read a name, short enough not to cover a row being edited. */
const SHOWN_MS = 4000;

export interface SavedNoticeValue {
  name: string;
  /** Changes on every save, so a second Save restarts the card's time. */
  at: number;
}

/**
 * The card a Save as copy answers with, the one save that stays on the page.
 * Only the heading changes, to a name the operator may not read again, so
 * without it a copy that worked and one that never left looked the same.
 *
 * The live region is always mounted and only its content comes and goes,
 * because a region inserted together with its text is not announced by
 * every screen reader.
 */
export function SavedNotice({
  notice,
  onDismiss,
}: {
  notice: SavedNoticeValue | null;
  onDismiss: () => void;
}) {
  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismiss, SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {notice && (
        <div
          className={cn(
            overlayPanel,
            "pointer-events-auto flex max-w-full items-center gap-2 py-2 pr-1.5 pl-3 text-sm",
          )}
        >
          <CheckIcon className="size-4 shrink-0 text-signal-live" aria-hidden />
          <span className="min-w-0 truncate">
            Saved <span className="font-medium">{notice.name}</span>
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-10"
          >
            <XIcon className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
