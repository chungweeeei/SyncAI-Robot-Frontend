"use client";

import * as React from "react";
import { OctagonXIcon } from "lucide-react";

import { useConsoleEstop } from "@/hooks/use-console-estop";
import { RELEASE_HOLD_MS } from "@/lib/robot/estop";
import { cn } from "@/lib/utils";

/**
 * The emergency stop, at the head of the masthead's presses on every screen.
 *
 * **One press engages it; only a held press releases it.** The asymmetry is
 * the point. Stopping has to cost nothing — no confirm, no hold, and on a
 * pointer it fires at the press rather than the release, so a finger that
 * slides off on the way up has still stopped the robot. Releasing has to cost
 * a deliberate second of attention, because the release is the same button in
 * the same place, and a stop that a second panicked tap could undo is one an
 * operator cannot trust.
 *
 * Icon-only like the presses beside it, by request; the name is on
 * `aria-label` and `title`, and drawn the way they are — the same full-height
 * square, framed only under a pointer — so the four read as one set. What
 * sets it apart is where it stands, first of them, and a hover in the warn hue.
 *
 * The hold follows one pointer, the one that pressed; a second finger is not a
 * second press. Lifting, a cancelled pointer or sliding off the button all
 * start it over. Enter or Space held for the same second releases it from the
 * keyboard, and repeats of the key are not a new press.
 */
export function EstopButton() {
  const { engaged, latched, engage, release, notice } = useConsoleEstop();
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

  // A stop the robot reports and this tab did not latch cannot be released
  // from here: release only clears this tab's latch. Holding would fill the
  // bar and change nothing, so the hold is not offered.
  const releasable = engaged && latched;

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

  // The click is the keyboard's engage (Enter on keydown, Space on keyup) and
  // nothing else. A pointer's click (`detail` above zero) is skipped: it
  // already engaged at its press and would only send the stop a second time,
  // and a click on an engaged stop is a tap, which must never release it.
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
    : releasable
      ? "Emergency stop engaged. Press and hold to release"
      : "Emergency stop engaged on the robot";

  const title = !engaged
    ? "Stop the robot: cancel the job and drop manual drive (Shift+Space)"
    : releasable
      ? "Press and hold for one second to release"
      : "The robot reports its emergency stop. It has to be released on the robot.";

  return (
    <button
      type="button"
      aria-pressed={engaged}
      aria-label={label}
      // No line under the strip, by request: what the last press could
      // not do rides on the hover and on the accessible description, so
      // it is there for whoever asks without covering the page.
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
      // A long press on a phone would otherwise open the callout or start
      // a text selection under the finger that is holding the release.
      onContextMenu={(event) => event.preventDefault()}
      className={cn(
        // The disclosures' own frame (strip-disclosure.tsx), by request, so
        // the four read as one set: no frame at rest, one under a pointer
        // or focus. Engaged takes the frame for good, in the warn hue where
        // an open panel takes cmd, because it is what the button reports.
        "relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border select-none [-webkit-touch-callout:none] touch-manipulation transition-colors focus-visible:outline-none",
        engaged
          ? "border-signal-warn/50 bg-signal-warn/12 text-signal-warn"
          : "border-transparent text-muted-foreground hover:border-signal-warn/50 hover:bg-signal-warn/12 hover:text-signal-warn focus-visible:border-hairline",
      )}
    >
      {/* The release's progress, filling under the label. A width
        * transition rather than a frame loop: it runs for exactly the
        * hold the timer waits for, and snaps back when the hold ends. */}
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
