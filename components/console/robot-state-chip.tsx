"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { TONE_TEXT, overlayPanel } from "@/components/console/instrument";
import { useRobotStateControl, type RobotStateControl } from "@/hooks/use-robot-state-control";
import {
  STATE_SILENT,
  STATE_SILENT_LABEL,
  STATE_SILENT_NAME,
  STUCK_JOB_NOTE,
  robotStatusView,
  type RobotStatusView,
} from "@/lib/robot/readiness";
import type { Tone } from "@/lib/types/tone";
import { cn } from "@/lib/utils";

/** The filled frame of a loud state, per hue. */
const LOUD: Partial<Record<Tone, string>> = {
  caution: "border-signal-caution/50 bg-signal-caution/12",
  warn: "border-signal-warn/50 bg-signal-warn/12",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  live: "bg-signal-live",
  cmd: "bg-signal-cmd",
  active: "bg-signal-active",
  caution: "bg-signal-caution",
  warn: "bg-signal-warn",
};

/**
 * The robot's state on every screen, right after the masthead's context line
 * (robot · mode · map), and the only coloured thing in that group: whether
 * the robot will take a job is what an operator acts on; the mode and map
 * rarely change.
 *
 * Two weights. Unconfirmed and Error — the robot takes no job that drives,
 * or none at all, until someone acts — are a framed, filled chip with a dot.
 * Every other state is a quiet dot and its word. A dash in no hue while the
 * robot is not reporting: the last frame's word is a memory then, and the
 * strip's link chip is what says the link is down.
 *
 * Only a state with something to do is a button and shows ▾: Unconfirmed
 * (confirm), Idle (withdraw the confirmation), Error (release and confirm),
 * and Running only when the robot counts a job the list does not have (clear
 * it). Its popover is the robot's sentence and that one button. Every other
 * state is text, its sentence in the hover title.
 *
 * Below `md` the word goes (into the accessible name and the title) and the
 * dot stays, with a halo in its hue for a loud state: a phone's first line
 * has room for the robot id and one mark.
 *
 * Nothing is drawn for a backend from before the state machine: its state
 * word means something else, and an "Unconfirmed" with nothing behind it
 * would be a dead end.
 */
export function RobotStateChip() {
  const control = useRobotStateControl();
  const [wantOpen, setOpen] = React.useState(false);
  const panelId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const { state, silent, message, action, reset } = control;
  // A state that stops offering anything (confirmed into Running, gone
  // silent) closes the popover by itself.
  const openable = action !== null;
  // Dropped, not only hidden, so a state that comes back openable (frames
  // resuming) does not reopen a popover nobody asked for since.
  if (wantOpen && !openable) setOpen(false);
  const open = wantOpen && openable;

  // Closed by a press anywhere outside it, as a menu is; the press itself
  // still reaches whatever it landed on.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (state === null && !silent) return null;
  const view: RobotStatusView =
    state === null
      ? { label: STATE_SILENT_LABEL, tone: "neutral", loud: false, detail: null }
      : robotStatusView(state);
  // A dash says nothing aloud or on hover.
  const name = state === null ? STATE_SILENT_NAME : view.label;
  // Silent, the hover says why: the backend's sentence, else the console's.
  const said = state === null ? (control.silence ?? STATE_SILENT) : message || view.detail;
  const title = `Robot state: ${name}${said ? ` — ${said}` : ""}`;

  const face = (
    <>
      <span
        aria-hidden
        className={cn(
          "shrink-0 rounded-full",
          DOT[view.tone],
          // Below `md` a loud state's dot wears a halo in its hue, drawn as
          // a ring so it takes no room: the first line has a few pixels to
          // spare before the robot id is cut.
          view.loud
            ? "size-2 max-md:size-2.5 max-md:ring-4 max-md:ring-current/25"
            : "size-2 max-md:size-2.5",
        )}
      />
      <span className="max-md:sr-only">{view.label}</span>
      {openable && (
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 transition-transform max-md:hidden motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      )}
    </>
  );
  const faceClass = cn(
    "instrument-label inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm whitespace-nowrap",
    TONE_TEXT[view.tone],
    view.loud ? cn("border px-1.5 max-md:border-0 max-md:bg-transparent max-md:px-0", LOUD[view.tone]) : "",
  );

  if (!openable) {
    return (
      <span title={title} className={faceClass}>
        {face}
      </span>
    );
  }

  const toggle = () => {
    // A refusal belongs to the press it answered, not to the next look.
    if (!open) reset();
    setOpen(!open);
  };
  // Escape closes and returns focus. On the subtree, not the window, which
  // the armed joystick's key handler owns (as strip-disclosure.tsx).
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative flex" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={`Robot state: ${name}`}
        title={title}
        onClick={toggle}
        className={cn(
          faceClass,
          "relative transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          view.loud ? "hover:brightness-95" : "-mx-1 px-1 hover:bg-elevated",
          // Under a finger the mark answers a press over the strip's height
          // and a little either side, never onto the stop.
          "pointer-coarse:max-md:after:absolute pointer-coarse:max-md:after:-inset-x-1.5 pointer-coarse:max-md:after:-inset-y-4",
        )}
      >
        {face}
      </button>

      <div id={panelId}>{open && <RobotStatePanel control={control} said={said} />}</div>
    </div>
  );
}

/** The one button; the state's own hue where it is the step owed. */
const ACTION =
  "instrument-label flex min-h-7 w-full items-center justify-center rounded-sm border px-2 py-1 text-center transition-colors disabled:opacity-50 pointer-coarse:min-h-10";

const ACTION_TONE = {
  confirm: "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd hover:bg-signal-cmd/20",
  "release-confirm":
    "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd hover:bg-signal-cmd/20",
  // Caution: it overrules what the robot believes about itself.
  "clear-stuck":
    "border-signal-caution/50 bg-signal-caution/12 text-signal-caution hover:bg-signal-caution/20",
  withdraw: "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
} as const;

/**
 * Under the strip, left-aligned to the chip; below `sm` fixed to the
 * viewport, as the strip's other panels are (strip-disclosure.tsx's
 * droppedPanel), since hung off a 16 px disc it would open past the phone's
 * edge. z-30 because <main>, a later sibling, would paint over it. No header:
 * the chip it hangs off already names the state, and a press outside closes
 * it, so it carries no ✕.
 */
const PANEL =
  "fixed top-16 left-3 z-30 w-48 max-w-[calc(100vw-1.5rem)] px-2.5 py-2 sm:absolute sm:top-full sm:left-0 sm:mt-1.5";

function RobotStatePanel({ control, said }: { control: RobotStateControl; said: string | null }) {
  const { action, stuck, busy, error, receipt, apply } = control;
  if (action === null) return null;

  return (
    <section role="dialog" aria-label="Robot state" className={cn(overlayPanel, PANEL)}>
      {/* role=status so a change of state is heard while the popover is
        * open; kept mounted when empty, since a live region added with its
        * text is not read. */}
      <div role="status" className="space-y-1 text-[11px] leading-snug break-words">
        {said && <p>{said}</p>}
        {stuck && <p className="text-signal-caution">{STUCK_JOB_NOTE}</p>}
        {receipt && <p className="text-muted-foreground">{receipt}</p>}
      </div>

      <button
        type="button"
        disabled={busy || action.lock !== null}
        onClick={() => apply(action.target)}
        className={cn(ACTION, ACTION_TONE[action.id], "mt-2")}
      >
        {action.label}
      </button>
      {/* A greyed button swallows its tooltip, so the reason is a line. */}
      {action.lock !== null && (
        <p className="mt-1.5 text-[11px] leading-snug text-signal-caution">{action.lock}</p>
      )}

      <ErrorLine className="mt-1.5">{error}</ErrorLine>
    </section>
  );
}
