"use client";

import * as React from "react";
import {
  CircleIcon,
  GripHorizontalIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";

import { overlayPanel, RecordDot } from "@/components/console/instrument";
import { panelFloor } from "@/components/console/strip-disclosure";
import { useCameraClip } from "@/hooks/use-camera-clip";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { isDrag } from "@/lib/map/gesture";
import { formatDuration, formatSize } from "@/lib/recording/format";
import type { ClipOutcome } from "@/lib/video/clip";
import { cn } from "@/lib/utils";

/** Pixel bounds for the window's own size, before the viewport clamps it. */
const MIN_WIDTH = 192;
const MIN_HEIGHT = 108;
const DEFAULT_WIDTH = 320;
/** 16:9, the shape the robot's encoder sends; the video letterboxes if resized off it. */
const DEFAULT_HEIGHT = 180;
/** Viewport margin the window keeps when it opens: the strip's right-3, both sides. */
const OPEN_MARGIN = 24;
/** One keyboard press of the move or resize handle. */
const KEY_STEP = 16;
/** How long the "saved" line sits on the picture; it covers what the window shows. */
const RECEIPT_MS = 6_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The size the window opens and resets to, narrowed to fit a phone at 16:9.
 * Measured on open only: the window mounts on a click, so there is no server
 * render to disagree with.
 */
function openingSize(): { width: number; height: number } {
  const width = clamp(window.innerWidth - OPEN_MARGIN, MIN_WIDTH, DEFAULT_WIDTH);
  return { width, height: Math.round((width * DEFAULT_HEIGHT) / DEFAULT_WIDTH) };
}

/** Whether a header press landed on a control. The move handle does not count. */
function pressedAControl(target: EventTarget): boolean {
  const button = (target as HTMLElement).closest("button");
  return button !== null && !button.hasAttribute("data-move-handle");
}

/**
 * What the operator is told once a capture ends. Every sentence names the
 * file's fate: a clip that stopped on its own still saved, and "stopped" alone
 * would read as lost.
 */
function receiptFor(outcome: ClipOutcome): { text: string; tone: string } {
  if (outcome.filename === null) {
    return outcome.error === null && outcome.end === "error"
      ? { text: "No picture to save yet.", tone: "text-signal-caution" }
      : { text: "The clip could not be saved.", tone: "text-signal-warn" };
  }

  const length = formatDuration(Math.round(outcome.elapsedMs / 1_000));
  switch (outcome.end) {
    case "limit":
      return {
        text: `Saved automatically at ${length}.`,
        tone: "text-signal-caution",
      };
    case "source":
      return {
        text: `The picture stopped — saved ${length}.`,
        tone: "text-signal-caution",
      };
    default:
      return {
        text: `Saved ${length} — check your downloads.`,
        tone: "text-signal-live",
      };
  }
}

/**
 * The robot's camera as a small window that follows the operator across the
 * console. Movable and resizable, since it always sits in front of something.
 * Both gestures record the pointer id and measure everything at pointerdown,
 * so pointermove never forces layout. Only the header drags and the corner
 * resizes; the picture itself is neither.
 *
 * Audio starts muted: the window is opened while doing something else, and a
 * console that started talking would be a surprise. Stream diagnostics belong
 * to /webrtc-test, not here.
 *
 * A clip capture deliberately survives the window closing (see
 * hooks/use-camera-clip.ts), and route changes do not interrupt it because the
 * strip that mounts this window is in the root layout.
 */
export function CameraWindow({ className }: { className?: string }) {
  const { phase, error, stream, retry } = useCameraStream();
  const clip = useCameraClip(stream);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [muted, setMuted] = React.useState(true);
  const [size, setSize] = React.useState(openingSize);
  /** Displacement from the caller's anchor, applied as a translate. */
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  const { last: clipOutcome, dismiss: dismissClip } = clip;
  React.useEffect(() => {
    if (!clipOutcome) return;
    const timer = setTimeout(dismissClip, RECEIPT_MS);
    return () => clearTimeout(timer);
  }, [clipOutcome, dismissClip]);

  const clipReceipt = clipOutcome && receiptFor(clipOutcome);

  const unsupportedId = React.useId();
  const clipTitle = !clip.supported
    ? "This browser cannot save clips"
    : phase !== "live"
      ? "Available once there is a picture"
      : clip.capturing
        ? "Stop and save the clip"
        : "Save a clip to this computer";

  // srcObject is a property, not an attribute, so it cannot be JSX. play() is
  // best-effort.
  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  const dragRef = React.useRef<{
    pointerId: number;
    kind: "move" | "resize";
    /** A move that began on the grip, so a release that never dragged is a tap on it. */
    onGrip: boolean;
    originX: number;
    originY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  // Not curried: `onGrab("move")` in JSX would be a render-time call reading a
  // ref, which the compiler lint rejects.
  const onGrab = (kind: "move" | "resize", event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current) return;
    if (kind === "move" && pressedAControl(event.target)) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    dragRef.current = {
      pointerId: event.pointerId,
      kind,
      onGrip:
        kind === "move" &&
        (event.target as HTMLElement).closest("[data-move-handle]") !== null,
      originX: event.clientX,
      originY: event.clientY,
      baseX: kind === "move" ? offset.x : size.width,
      baseY: kind === "move" ? offset.y : size.height,
      // Moving: keep every edge on screen, or the window is unrecoverable.
      // Resizing: width grows leftward (see onDrag), so the left gap limits it.
      minX: kind === "move" ? offset.x - rect.left : MIN_WIDTH,
      maxX:
        kind === "move"
          ? offset.x + (window.innerWidth - rect.right)
          : size.width + rect.left,
      minY: kind === "move" ? offset.y - rect.top : MIN_HEIGHT,
      maxY:
        kind === "move"
          ? offset.y + (panelFloor() - rect.bottom)
          : size.height + (panelFloor() - rect.bottom),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.originX;
    const dy = event.clientY - drag.originY;

    if (drag.kind === "move") {
      setOffset({
        x: clamp(drag.baseX + dx, drag.minX, drag.maxX),
        y: clamp(drag.baseY + dy, drag.minY, drag.maxY),
      });
      return;
    }

    // The window is anchored by its right edge, so the handle sits bottom-LEFT
    // (the edge that moves) and the horizontal delta is negated.
    setSize({
      width: clamp(drag.baseX - dx, drag.minX, drag.maxX),
      height: clamp(drag.baseY + dy, drag.minY, drag.maxY),
    });
  };

  // Up, cancel and lost-capture all end the gesture; idempotent via the ref
  // check because pointerup is followed by an implicit lostpointercapture.
  const onRelease = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    // A tap on the grip resets the window: the touch form of Home and
    // double-click. Only a real pointerup counts as a tap.
    if (
      event.type === "pointerup" &&
      drag.onGrip &&
      !isDrag(drag.originX, drag.originY, event.clientX, event.clientY)
    ) {
      setOffset({ x: 0, y: 0 });
      setSize(openingSize());
    }
  };

  // Keyboard move, clamped like a drag; Home resets like a double-click.
  const onMoveKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Home") {
      event.preventDefault();
      setOffset({ x: 0, y: 0 });
      setSize(openingSize());
      return;
    }
    const dx = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    const dy = event.key === "ArrowUp" ? -KEY_STEP : event.key === "ArrowDown" ? KEY_STEP : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();

    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setOffset((current) => ({
      x: clamp(current.x + dx, current.x - rect.left, current.x + (window.innerWidth - rect.right)),
      y: clamp(current.y + dy, current.y - rect.top, current.y + (panelFloor() - rect.bottom)),
    }));
  };

  // Keyboard resize. Left is wider because the handle is on the left.
  const onHandleKeyDown = (event: React.KeyboardEvent) => {
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    if (!horizontal && !vertical) return;
    event.preventDefault();

    const grow = event.key === "ArrowLeft" || event.key === "ArrowDown";
    const step = grow ? KEY_STEP : -KEY_STEP;
    const rect = panelRef.current?.getBoundingClientRect();

    setSize((current) => ({
      width: horizontal
        ? clamp(
            current.width + step,
            MIN_WIDTH,
            rect ? current.width + rect.left : current.width,
          )
        : current.width,
      height: vertical
        ? clamp(
            current.height + step,
            MIN_HEIGHT,
            rect ? current.height + (panelFloor() - rect.bottom) : current.height,
          )
        : current.height,
    }));
  };

  return (
    <div
      ref={panelRef}
      style={{
        width: size.width,
        transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
      className={cn(overlayPanel, "p-2", className)}
    >
      {/* touch-none, or a touch drag scrolls the page and the browser answers
        * with pointercancel mid-gesture (the thumbstick's rule). */}
      <header
        onPointerDown={(event) => onGrab("move", event)}
        onPointerMove={onDrag}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onLostPointerCapture={onRelease}
        onDoubleClick={(event) => {
          // Or a quick start-stop on the clip button would also reset the window.
          if (pressedAControl(event.target)) return;
          setOffset({ x: 0, y: 0 });
          setSize(openingSize());
        }}
        title="Drag to move · tap the grip to reset"
        className="mb-2 flex h-4 cursor-grab touch-none items-center justify-between gap-2 select-none active:cursor-grabbing pointer-coarse:h-10"
      >
        <h2 className="instrument-label flex items-center gap-1.5 text-muted-foreground">
          {/* The grip as a button, so the keyboard can move the window too. */}
          <button
            type="button"
            data-move-handle
            aria-label="Move the camera window"
            title="Drag to move · tap to reset · arrow keys to nudge · Home to reset"
            onKeyDown={onMoveKeyDown}
            className="-m-0.5 flex cursor-grab items-center rounded-sm p-0.5 pointer-coarse:p-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          >
            <GripHorizontalIcon aria-hidden className="size-3" />
          </button>
          Camera
        </h2>
        <div className="flex items-center gap-1">
          {/* Record red, not commanded cyan: it starts something running, as
            * the recorder's signal-warn does. */}
          <button
            type="button"
            aria-pressed={clip.capturing}
            aria-label="Video clip"
            aria-describedby={clip.supported ? undefined : unsupportedId}
            disabled={!clip.supported || phase !== "live"}
            onClick={() => (clip.capturing ? clip.stop() : clip.start())}
            title={clipTitle}
            className={cn(
              "flex size-5 items-center justify-center rounded-sm border transition-colors pointer-coarse:size-10",
              clip.capturing
                ? "border-signal-warn/50 bg-signal-warn/12 text-signal-warn"
                : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
              "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
            )}
          >
            {clip.capturing ? (
              <SquareIcon aria-hidden className="size-3 fill-current" />
            ) : (
              <CircleIcon aria-hidden className="size-3 fill-current" />
            )}
          </button>
          {!clip.supported && (
            <span id={unsupportedId} className="sr-only">
              {clipTitle}
            </span>
          )}

          <button
            type="button"
            aria-pressed={!muted}
            aria-label="Robot audio"
            onClick={() => setMuted((v) => !v)}
            title={muted ? "Turn on the robot's audio" : "Mute the robot's audio"}
            className={cn(
              "flex size-5 items-center justify-center rounded-sm border transition-colors pointer-coarse:size-10",
              muted
                ? "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground"
                : "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd",
            )}
          >
            {muted ? (
              <VolumeXIcon aria-hidden className="size-3" />
            ) : (
              <Volume2Icon aria-hidden className="size-3" />
            )}
          </button>
        </div>
      </header>

      <div className="relative bg-black" style={{ height: size.height }}>
        <video
          ref={videoRef}
          // playsInline keeps iOS from going fullscreen. No `controls`: the bar
          // would cover the picture, and sound and size are the window's own.
          playsInline
          muted={muted}
          className="h-full w-full object-contain"
        />

        {phase !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center">
            {phase === "connecting" ? (
              <p className="instrument-label text-muted-foreground">Connecting</p>
            ) : (
              <div>
                <p className="readout text-[11px] break-words text-signal-warn">
                  {error ?? "No video from the robot."}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="instrument-label mt-2 rounded-sm border border-hairline px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {clip.capturing && (
          // aria-hidden: a duration re-read every second is unusable; the
          // status line below covers it.
          <div
            aria-hidden
            className="absolute top-1 left-1 flex items-center gap-1.5 rounded-sm bg-black/60 px-1.5 py-0.5"
          >
            <RecordDot />
            <span className="readout text-[10px] leading-none text-white">
              {formatDuration(clip.elapsedSeconds)} · {formatSize(clip.bytes)}
            </span>
          </div>
        )}

        <span role="status" className="sr-only">
          {clip.capturing
            ? "Saving a clip"
            : (clipReceipt?.text ?? "")}
        </span>

        {!clip.capturing && clipReceipt && (
          // Bottom-right: bottom-left is the resize grip and the middle is
          // where a failed session puts its sentence.
          <p
            className={cn(
              "readout absolute right-0.5 bottom-0.5 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] leading-tight",
              clipReceipt.tone,
            )}
          >
            {clipReceipt.text}
          </p>
        )}

        {/* Bottom-left (see onDrag), inside the picture rather than in the
          * panel's padding, where it would be invisible. */}
        <button
          type="button"
          aria-label="Resize the camera window"
          title="Drag to resize · arrow keys to nudge"
          onPointerDown={(event) => onGrab("resize", event)}
          onPointerMove={onDrag}
          onPointerUp={onRelease}
          onPointerCancel={onRelease}
          onLostPointerCapture={onRelease}
          onKeyDown={onHandleKeyDown}
          className="group absolute bottom-0 left-0 size-5 cursor-nesw-resize touch-none pointer-coarse:size-10"
        >
          {/* Two drawn diagonal strokes, so they sit flush in the corner. */}
          {[0, 4].map((inset) => (
            <span
              key={inset}
              aria-hidden
              className="absolute bottom-0.5 left-0.5 block h-px bg-white/60 transition-colors group-hover:bg-white group-focus-visible:bg-signal-cmd"
              style={{
                width: 11 - inset * 1.5,
                transformOrigin: "bottom left",
                transform: `translate(${inset}px, ${-inset}px) rotate(45deg)`,
              }}
            />
          ))}
        </button>
      </div>
    </div>
  );
}
