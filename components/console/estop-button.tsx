"use client";

import * as React from "react";
import { OctagonXIcon } from "lucide-react";

import { useConsoleEstop } from "@/hooks/use-console-estop";
import { RELEASE_HOLD_MS } from "@/lib/robot/estop";
import { cn } from "@/lib/utils";

/**
 * The emergency stop, first of the masthead's presses on every screen.
 *
 * **One press engages it; only a held press releases it.** Stopping costs
 * nothing, and fires at pointerdown so a finger sliding off still stops the
 * robot. Releasing costs a deliberate second, since a stop a panicked second
 * tap could undo is one an operator cannot trust.
 *
 * Icon-only and framed like the disclosures beside it, by request. The hold
 * follows the pressing pointer; lifting, cancel or sliding off restarts it.
 * Enter or Space held the same second releases from the keyboard; key repeats
 * are not a new press.
 */
export function EstopButton() {
  const { engaged, releasing, engage, release, notice } = useConsoleEstop();
  const [holding, setHolding] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  const pointerRef = React.useRef<number | null>(null);
  const noticeId = React.useId();

  const stopHold = React.useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pointerRef.current = null;
    setHolding(false);
  }, []);

  const startHold = React.useCallback(() => {
    if (timerRef.current !== null) return;
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pointerRef.current = null;
      setHolding(false);
      release();
    }, RELEASE_HOLD_MS);
  }, [release]);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Any engaged lock is releasable here, whoever engaged it — but not while a
  // release is already on its way.
  const releasable = engaged && !releasing;

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || pointerRef.current !== null) return;
    if (!engaged) {
      // At the press, not the click: see above.
      engage();
      return;
    }
    if (!releasable) return;
    pointerRef.current = event.pointerId;
    startHold();
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerId === pointerRef.current) stopHold();
  };

  // Only the keyboard engages by click. A pointer click (`detail` > 0) already
  // engaged at its press, and must never release.
  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && !engaged) engage();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat || !releasable) return;
    startHold();
  };

  const onKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") stopHold();
  };

  const label = !engaged
    ? "Emergency stop"
    : releasing
      ? "Emergency stop engaged. Releasing"
      : "Emergency stop engaged. Press and hold to release";

  const title = !engaged
    ? "Stop the robot: lock its motion and cancel every job (Shift+Space)"
    : releasing
      ? "Releasing…"
      : "Press and hold for one second to release";

  return (
    <button
      type="button"
      aria-pressed={engaged}
      aria-label={label}
      // A failed press is reported on hover and in the description, not in a
      // line under the strip, by request.
      aria-describedby={notice ? noticeId : undefined}
      title={notice ? `${title}\n\n${notice}` : title}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerLeave={onPointerEnd}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={stopHold}
      // A held release must not open a callout or a text selection.
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        // The disclosures' frame (strip-disclosure.tsx); engaged keeps it, in warn.
        "relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border select-none [-webkit-touch-callout:none] touch-manipulation transition-colors focus-visible:outline-none",
        engaged
          ? "border-signal-warn/50 bg-signal-warn/12 text-signal-warn"
          : "border-transparent text-muted-foreground hover:border-signal-warn hover:bg-signal-warn/12 hover:text-signal-warn focus-visible:border-hairline",
      )}
    >
      {/* The hold's progress: a width transition timed to the hold. */}
      {releasable && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 bg-signal-warn/30 ease-linear",
            holding ? "w-full transition-[width]" : "w-0",
          )}
          style={{ transitionDuration: holding ? `${RELEASE_HOLD_MS}ms` : undefined }}
        />
      )}
      <OctagonXIcon aria-hidden className="relative size-5 shrink-0" />
      {notice && (
        <span id={noticeId} className="sr-only">
          {notice}
        </span>
      )}
    </button>
  );
}
