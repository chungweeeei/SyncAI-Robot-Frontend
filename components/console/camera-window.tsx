"use client";

import * as React from "react";
import { GripHorizontalIcon, Volume2Icon, VolumeXIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { useCameraStream } from "@/hooks/use-camera-stream";
import { cn } from "@/lib/utils";

/** Pixel bounds for the window's own size, before the viewport clamps it. */
const MIN_WIDTH = 192;
const MIN_HEIGHT = 108;
const DEFAULT_WIDTH = 320;
/** 16:9, the shape the robot's encoder sends; the video letterboxes if resized off it. */
const DEFAULT_HEIGHT = 180;
/** One keyboard press of the resize handle. Coarse enough to be worth pressing. */
const KEY_STEP = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The robot's camera as a small window that follows the operator across the
 * console — the "watch where it is going while doing something else" panel.
 *
 * Movable and resizable, because it is by definition in front of something:
 * unlike the drive panel it has no corner it can be said to belong in, and the
 * one thing an operator wants from a video window is for it to be bigger while
 * they look at it and out of the way when they do not. Both gestures follow the
 * thumbstick's gestureRef idiom — pointer identity plus everything measured
 * once at pointerdown, so pointermove never forces layout.
 *
 * The header drags and the corner resizes; the body is neither, because the
 * body is the picture and a video that moved when you tried to point at
 * something in it would be a window fighting its own content.
 *
 * Audio arrives on the same session — the Opus track rides the camera's
 * pipeline — and starts muted. Not for the autoplay policy (the panel opens
 * from a click) but because this window is opened *while doing something
 * else*: a console that started talking because a panel was opened on the
 * Settings screen would be a surprise, and the speaker button is right there.
 *
 * What it does not have is the bench's readouts. Resolution, bitrate, the
 * candidate pair and the rest answer "why is the video bad", which is a
 * question for /webrtc-test; this window answers "what can the robot see".
 */
export function CameraWindow({ className }: { className?: string }) {
  const { phase, error, stream, retry } = useCameraStream();

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [muted, setMuted] = React.useState(true);
  const [size, setSize] = React.useState({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  });
  /**
   * Displacement from the anchor the caller positioned us at, applied as a
   * translate — the same arrangement as the drive panel, so where the window
   * first appears stays the caller's business and the offset survives that
   * anchor changing.
   */
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  // srcObject is a property, not an attribute, so it cannot be JSX. play() is
  // best-effort: the element keeps `controls` as the fallback when a policy
  // refuses it.
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
    originX: number;
    originY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  // Takes the kind as an argument rather than currying it, so nothing calls
  // this during render: a `onGrab("move")` in JSX is a call, and a call that
  // reads a ref is one the compiler cannot prove happens in a handler.
  const onGrab = (kind: "move" | "resize", event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current) return;
    // The header carries the speaker button; a press on it is a press on it.
    if (kind === "move" && (event.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();

    dragRef.current = {
      pointerId: event.pointerId,
      kind,
      originX: event.clientX,
      originY: event.clientY,
      baseX: kind === "move" ? offset.x : size.width,
      baseY: kind === "move" ? offset.y : size.height,
      // Moving: how far the window may still travel before an edge leaves the
      // viewport — one dragged fully off-screen is unrecoverable. Resizing:
      // how much it may still grow. Width grows leftward (see onDrag), so what
      // limits it is the gap to the left edge, not the right.
      minX: kind === "move" ? offset.x - rect.left : MIN_WIDTH,
      maxX:
        kind === "move"
          ? offset.x + (window.innerWidth - rect.right)
          : size.width + rect.left,
      minY: kind === "move" ? offset.y - rect.top : MIN_HEIGHT,
      maxY:
        kind === "move"
          ? offset.y + (window.innerHeight - rect.bottom)
          : size.height + (window.innerHeight - rect.bottom),
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

    // The handle is the bottom-LEFT corner, and the window is anchored by its
    // right edge to the button that opened it. Widening therefore moves the
    // left edge left, which is where the handle is — so the corner tracks the
    // pointer, and the horizontal delta is negated to say so. With the handle
    // on the right it did not track at all: the opposite edge moved while the
    // grabbed corner stood still.
    setSize({
      width: clamp(drag.baseX - dx, drag.minX, drag.maxX),
      height: clamp(drag.baseY + dy, drag.minY, drag.maxY),
    });
  };

  // Up, cancel and lost-capture all end the gesture; idempotent via the ref
  // check because pointerup is followed by an implicit lostpointercapture.
  const onRelease = (event: React.PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
  };

  // The handle is a button, so it is focusable, and arrow keys are the only
  // way to resize without a pointer. Each key moves the handle the way the
  // pointer would move it: left is wider because the handle is on the left.
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
            rect ? current.height + (window.innerHeight - rect.bottom) : current.height,
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
        onDoubleClick={() => {
          setOffset({ x: 0, y: 0 });
          setSize({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
        }}
        title="Drag to move · double-click to reset"
        className="mb-2 flex h-4 cursor-grab touch-none items-center justify-between gap-2 select-none active:cursor-grabbing"
      >
        <h2 className="instrument-label flex items-center gap-1.5 text-muted-foreground">
          <GripHorizontalIcon aria-hidden className="size-3" />
          Camera
        </h2>
        <button
          type="button"
          aria-pressed={!muted}
          aria-label="Robot audio"
          onClick={() => setMuted((v) => !v)}
          title={muted ? "Turn on the robot's audio" : "Mute the robot's audio"}
          className={cn(
            "flex size-5 items-center justify-center rounded-sm border transition-colors",
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
      </header>

      <div className="relative bg-black" style={{ height: size.height }}>
        <video
          ref={videoRef}
          // playsInline so iOS Safari does not hijack it into a fullscreen
          // player. No `controls`: at this size the bar covers the picture, and
          // the two things it offers that matter here — sound and size — are
          // this window's own header and corner.
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
                {/* The backend's own sentence, verbatim — it is written for
                  * operators, and rephrasing it here would lose what it says. */}
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

        {/* Bottom-LEFT, the corner that moves when the window grows — see
          * onDrag. Inside the picture rather than in the panel's 8px padding,
          * where it would be both invisible and off the shape it resizes. */}
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
          className="group absolute bottom-0 left-0 size-5 cursor-nesw-resize touch-none"
        >
          {/* Two diagonal strokes, the platform's own resize-grip shape, drawn
            * rather than iconed so they sit flush in the corner. Both rotate
            * about the same origin and carry no class that would fight the
            * transform; the inner one is shorter and inset. */}
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
