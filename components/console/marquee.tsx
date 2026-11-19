"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/** How fast a line too wide for its frame crawls past, in px per second. */
const MARQUEE_SPEED_PX_S = 40;

/** The `marquee` keyframes rest on the start for this share of a lap. */
const MARQUEE_REST = 0.18;

/** The space between the end of one lap's text and the start of the next. */
const MARQUEE_GAP = "w-12";
const MARQUEE_GAP_PX = 48;

/**
 * One line that scrolls only when it does not fit (by request: the masthead's
 * job line was being cut short of the step's detail). A line that fits stands
 * still, so a short one reads exactly as it did.
 *
 * Moving, it holds the text twice — the second copy `aria-hidden`, so a
 * screen reader and the `role="status"` around it read the line once — and
 * pauses under the pointer or while the link it sits in has focus. With
 * reduced motion it never moves and is cut with an ellipsis instead.
 *
 * Measured in a ResizeObserver rather than in render: the width is the
 * browser's, and the observer also reports a step changing the text.
 */
export function Marquee({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const frameRef = React.useRef<HTMLSpanElement>(null);
  const textRef = React.useRef<HTMLSpanElement>(null);
  /** The text's width while it overflows, else null (standing still). */
  const [overflow, setOverflow] = React.useState<number | null>(null);

  React.useEffect(() => {
    const frame = frameRef.current;
    const text = textRef.current;
    if (!frame || !text) return;
    const measure = () => {
      const width = text.scrollWidth;
      setOverflow(width > frame.clientWidth + 1 ? width : null);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);

  const moving = overflow !== null;
  const lapS = moving
    ? (overflow + MARQUEE_GAP_PX) / MARQUEE_SPEED_PX_S / (1 - MARQUEE_REST)
    : 0;

  return (
    <span ref={frameRef} className={cn("block min-w-0 overflow-hidden", className)}>
      <span
        className={cn(
          "flex",
          moving &&
            "marquee w-max in-focus-visible:[animation-play-state:paused] in-hover:[animation-play-state:paused] motion-reduce:w-auto",
        )}
        style={
          moving
            ? ({ "--marquee-duration": `${lapS.toFixed(1)}s` } as React.CSSProperties)
            : undefined
        }
      >
        <span
          ref={textRef}
          className={cn(
            "min-w-0 whitespace-nowrap",
            moving ? "shrink-0 motion-reduce:shrink motion-reduce:truncate" : "truncate",
          )}
        >
          {children}
        </span>
        {moving && (
          <>
            <span aria-hidden className={cn(MARQUEE_GAP, "shrink-0 motion-reduce:hidden")} />
            <span aria-hidden className="shrink-0 whitespace-nowrap motion-reduce:hidden">
              {children}
            </span>
            <span aria-hidden className={cn(MARQUEE_GAP, "shrink-0 motion-reduce:hidden")} />
          </>
        )}
      </span>
    </span>
  );
}
