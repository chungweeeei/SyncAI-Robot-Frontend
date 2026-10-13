"use client";

import * as React from "react";

import { createTeleopChannel } from "@/lib/ros/teleop-channel";
import type { TeleopVector } from "@/lib/types/robot";

/** How long a refusal stays after frames stop being refused: the backend
 *  sends no "refusal ended", so silence plus a TTL is the only way to clear. */
const REFUSAL_TTL_MS = 2000;

export type TeleopLink =
  | { phase: "connecting" }
  | { phase: "sending"; refusal: string | null };

/**
 * Opens the teleop channel for the lifetime of the calling component.
 *
 * The mount is the lifecycle, not an `armed` parameter: the owner mounts the
 * caller only while armed, so the initial useState is the per-session reset
 * with no setState in an effect body.
 *
 * `onDrop` fires when the socket goes down (never after our own cleanup) and
 * the owner disarms. It is read through a ref so an identity change cannot
 * reopen the socket. No re-renders while driving: the 10 Hz loop reads
 * vectorRef.
 */
export function useTeleopSender(
  vectorRef: React.RefObject<TeleopVector>,
  onDrop: () => void,
): TeleopLink {
  const [link, setLink] = React.useState<TeleopLink>({ phase: "connecting" });

  const onDropRef = React.useRef(onDrop);
  React.useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  React.useEffect(() => {
    let refusalTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = createTeleopChannel(vectorRef, {
      onOpen: () => setLink({ phase: "sending", refusal: null }),
      onRefusal: (message) => {
        // Repeated per refused frame (~10 Hz): only a *changed* message sets
        // state, or the panel re-renders at frame rate. The TTL restarts anyway.
        setLink((prev) =>
          prev.phase === "sending" && prev.refusal === message
            ? prev
            : { phase: "sending", refusal: message },
        );
        if (refusalTimer !== null) clearTimeout(refusalTimer);
        refusalTimer = setTimeout(() => {
          setLink((prev) =>
            prev.phase === "sending" ? { phase: "sending", refusal: null } : prev,
          );
        }, REFUSAL_TTL_MS);
      },
      onDown: () => onDropRef.current(),
    });

    return () => {
      if (refusalTimer !== null) clearTimeout(refusalTimer);
      channel.close();
    };
  }, [vectorRef]);

  return link;
}
