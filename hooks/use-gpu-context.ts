"use client";

import * as React from "react";

/**
 * How long a lost GPU context gets to come back before the view gives up on
 * it. A browser usually returns one within a second or two (a driver reset, a
 * tab that lost its slot to another); past this it is not coming.
 */
export const GPU_RESTORE_TIMEOUT_MS = 5000;

export class GpuContextLostError extends Error {
  constructor() {
    super("The 3D view lost its graphics context and it did not come back");
    this.name = "GpuContextLostError";
  }
}

export interface GpuContext {
  /** True between a loss and its restore, while the canvas shows nothing. */
  lost: boolean;
  onContextLost: () => void;
  onContextRestored: () => void;
}

/**
 * A 3D view's GPU context, as React state. Handed to `createViewport`'s loop.
 *
 * A context that never returns is thrown from render on purpose: the view's
 * ViewportBoundary then offers Try again, which remounts the view onto a fresh
 * renderer — the one recovery there is, and one the operator should choose,
 * since it drops the camera they had.
 */
export function useGpuContext(timeoutMs = GPU_RESTORE_TIMEOUT_MS): GpuContext {
  const [state, setState] = React.useState<"ok" | "lost" | "failed">("ok");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onContextLost = React.useCallback(() => {
    clear();
    setState("lost");
    timer.current = setTimeout(() => setState("failed"), timeoutMs);
  }, [timeoutMs]);

  const onContextRestored = React.useCallback(() => {
    clear();
    setState("ok");
  }, []);

  React.useEffect(() => clear, []);

  if (state === "failed") throw new GpuContextLostError();
  return { lost: state === "lost", onContextLost, onContextRestored };
}
