"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  EraserIcon,
  InfoIcon,
  LocateOffIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorLine } from "@/components/console/error-line";
import { TONE_TEXT } from "@/components/console/instrument";
import { panelEnter } from "@/components/console/strip-disclosure";
import { useRobotStateControl, type RobotStateControl } from "@/hooks/use-robot-state-control";
import {
  STATE_SILENT,
  STATE_SILENT_LABEL,
  STATE_SILENT_NAME,
  STUCK_JOB_NOTE,
  robotStatusView,
  type RobotStatusView,
  type StateAction,
} from "@/lib/robot/readiness";
import type { Tone } from "@/lib/types/tone";
import { cn } from "@/lib/utils";

/** The filled frame of a loud state, per hue. */
const LOUD: Partial<Record<Tone, string>> = {
  caution: "border-signal-caution/45 bg-signal-caution/10 hover:bg-signal-caution/16",
  warn: "border-signal-warn/45 bg-signal-warn/10 hover:bg-signal-warn/16",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  live: "bg-signal-live",
  cmd: "bg-signal-cmd",
  active: "bg-signal-active",
  caution: "bg-signal-caution",
  warn: "bg-signal-warn",
};

/** The 8 % tint behind the popover's state icon. */
const TINT: Record<Tone, string> = {
  neutral: "bg-muted",
  live: "bg-signal-live/12",
  cmd: "bg-signal-cmd/12",
  active: "bg-signal-active/12",
  caution: "bg-signal-caution/12",
  warn: "bg-signal-warn/12",
};

/**
 * The robot's state on every screen, right after the masthead's context line
 * (robot · mode · map), and the only coloured thing in that group: whether
 * the robot will take a job is what an operator acts on; the mode and map
 * rarely change.
 *
 * Two weights. Unconfirmed and Error — the robot takes no job that drives,
 * or none at all, until someone acts — are a framed, filled chip, its dot
 * pulsing, in one segment: a second naming the press was tried and dropped
 * as too busy for the strip. Every other state is a quiet dot and its word. A
 * dash in no hue while the robot is not reporting: the last frame's word is
 * a memory then, and the strip's link chip is what says the link is down.
 *
 * Only a state with something to do is a button and shows ▾: Unconfirmed
 * (confirm), Idle (withdraw the confirmation), Error (release and confirm),
 * and Running only when the robot counts a job the list does not have (clear
 * it). Its popover is a small card, kept to what the press needs (by
 * request): the state, the robot's sentence, why the press is held if it
 * is, and that one button. Every other state is text, its sentence in the
 * hover title. This is the one place the position is confirmed; the
 * dashboard has no panel of its own.
 *
 * Below `md` the word goes (into the accessible name and the
 * title) and the dot stays, with a halo in its hue for a loud state: a
 * phone's first line has room for the robot id and one mark.
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

  const dot = (
    <span aria-hidden className="relative flex shrink-0">
      {/* A loud state is owed a press: its dot breathes, once a second and
        * a half, and not at all under reduced motion. */}
      {view.loud && (
        <span
          className={cn(
            "absolute inset-0 animate-ping rounded-full opacity-60 [animation-duration:1.6s] motion-reduce:hidden",
            DOT[view.tone],
          )}
        />
      )}
      <span
        className={cn(
          "relative size-2 rounded-full max-md:size-2.5",
          DOT[view.tone],
          // Below `md` a loud state's dot wears a halo in its hue, drawn as
          // a ring so it takes no room: the first line has a few pixels to
          // spare before the robot id is cut.
          view.loud && "max-md:ring-4 max-md:ring-current/25",
        )}
      />
    </span>
  );
  const chevron = openable && (
    <ChevronDownIcon
      aria-hidden
      className={cn(
        "size-3 shrink-0 transition-transform max-md:hidden motion-reduce:transition-none",
        open && "rotate-180",
      )}
    />
  );

  if (!openable) {
    return (
      <span
        title={title}
        className={cn(
          "instrument-label inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap",
          TONE_TEXT[view.tone],
        )}
      >
        {dot}
        <span className="max-md:sr-only">{view.label}</span>
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
          "instrument-label relative inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm whitespace-nowrap transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          TONE_TEXT[view.tone],
          view.loud
            ? cn(
                "border pr-1.5 pl-2 max-md:border-0 max-md:px-0 max-md:bg-transparent max-md:hover:bg-transparent",
                LOUD[view.tone],
                // Not below `md`, where the chip is a bare dot with its halo.
                open && "md:ring-2 md:ring-current/20",
              )
            : cn("-mx-1.5 px-1.5 hover:bg-elevated", open && "bg-elevated"),
          // Under a finger the mark answers a press over the strip's height
          // and a little either side, never onto the stop.
          "pointer-coarse:max-md:after:absolute pointer-coarse:max-md:after:-inset-x-1.5 pointer-coarse:max-md:after:-inset-y-4",
        )}
      >
        {dot}
        <span className="max-md:sr-only">{view.label}</span>
        {chevron}
      </button>

      <div id={panelId}>
        {open && (
          <RobotStatePanel
            control={control}
            view={view}
            said={said}
          />
        )}
      </div>
    </div>
  );
}

/** The state's mark in the popover's header. */
const STATE_ICON: Partial<Record<string, LucideIcon>> = {
  UNINITIALIZED: LocateOffIcon,
  ERROR: TriangleAlertIcon,
  IDLE: CircleCheckIcon,
  RUNNING: CircleDashedIcon,
};

/** The button's icon, per action. */
const ACTION_ICON: Record<StateAction["id"], LucideIcon> = {
  confirm: CheckIcon,
  "release-confirm": RotateCcwIcon,
  "clear-stuck": EraserIcon,
  withdraw: Undo2Icon,
};

/**
 * Confirm is the console's primary action, solid Commanded Cyan; the other
 * three are outlined. Clearing a stuck job is in caution: it overrules what
 * the robot believes about itself. Nothing is solid red.
 */
const ACTION_STYLE: Record<StateAction["id"], { variant: "default" | "outline"; className?: string }> = {
  confirm: { variant: "default" },
  "release-confirm": { variant: "default" },
  "clear-stuck": {
    variant: "outline",
    className:
      "border-signal-caution/50 bg-signal-caution/8 text-signal-caution hover:bg-signal-caution/15 hover:text-signal-caution dark:border-signal-caution/50 dark:bg-signal-caution/8 dark:hover:bg-signal-caution/15",
  },
  withdraw: { variant: "outline" },
};

/**
 * Under the strip, left-aligned to the chip; below `sm` fixed to the
 * viewport across its width, as the strip's other panels are
 * (strip-disclosure.tsx's droppedPanel), since hung off a 16 px disc it would
 * open past the phone's edge. z-30 because <main>, a later sibling, would
 * paint over it. A popover, so the menu's shadow; solid, not the map
 * panels' blur, since it is read over the strip and the screen alike.
 * It opens as the strip's other panels do (panelEnter), out of the chip's
 * corner.
 */
const PANEL = cn(
  "fixed inset-x-3 top-16 z-30 space-y-3 rounded-md border border-hairline bg-panel p-3 text-foreground shadow-md sm:absolute sm:inset-x-auto sm:top-full sm:left-0 sm:mt-2 sm:w-72",
  "origin-top sm:origin-top-left",
  panelEnter,
);

function RobotStatePanel({
  control,
  view,
  said,
}: {
  control: RobotStateControl;
  view: RobotStatusView;
  said: string | null;
}) {
  const { state, action, stuck, busy, error, receipt, apply } = control;
  if (action === null) return null;

  const Icon = (state && STATE_ICON[state]) || InfoIcon;
  const ActionIcon = ACTION_ICON[action.id];
  const style = ACTION_STYLE[action.id];

  return (
    <section role="dialog" aria-label="Robot state" className={PANEL}>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-sm",
            TINT[view.tone],
            TONE_TEXT[view.tone],
          )}
        >
          <Icon className="size-4" />
        </span>
        {/* role=status so a change of state is heard while the popover is
          * open; kept mounted when empty, since a live region added with its
          * text is not read. */}
        <div role="status" className="min-w-0 space-y-1 break-words">
          <p className={cn("text-[14px] leading-7 font-semibold", TONE_TEXT[view.tone])}>
            {view.label}
          </p>
          {said && <p className="text-[12px] leading-snug text-muted-foreground">{said}</p>}
          {receipt && (
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-signal-live">
              <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {receipt}
            </p>
          )}
        </div>
      </div>

      {stuck && <Callout>{STUCK_JOB_NOTE}</Callout>}
      {/* A greyed button swallows its tooltip, so the reason is said. */}
      {action.lock !== null && <Callout>{action.lock}</Callout>}

      <Button
        type="button"
        variant={style.variant}
        disabled={busy || action.lock !== null}
        onClick={() => apply(action.target)}
        className={cn("w-full", style.className)}
      >
        <ActionIcon aria-hidden />
        {action.label}
      </Button>
      <ErrorLine className="-mt-1.5 text-[12px]">{error}</ErrorLine>
    </section>
  );
}

/** A hold or a warning, said in caution beside an icon rather than as a bare line. */
function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-sm border border-signal-caution/35 bg-signal-caution/8 px-2.5 py-2 text-[12px] leading-snug break-words text-signal-caution">
      <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
