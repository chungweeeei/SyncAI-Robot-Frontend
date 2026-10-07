"use client";

import * as React from "react";

/**
 * The console's emergency stop, as a context.
 *
 * Console-wide rather than owned by the button, because what it holds is read
 * far from the strip: the drive panel disarms on it, and the command hooks
 * refuse to send the robot anywhere while it is engaged. Split from its
 * provider (components/console/estop-provider.tsx) for the reason the two
 * poll contexts beside it record — hooks read it, and a hook may not import
 * from `components/`.
 */
export interface ConsoleEstop {
  /**
   * The robot reporting its safety lock on, or this tab's press the robot
   * has not answered yet — see `estopEngaged`.
   */
  engaged: boolean;
  /** A release has been sent and has not been answered yet. */
  releasing: boolean;
  /** Hold the controls, then ask for the lock. Never waits on the answer. */
  engage: () => void;
  /** Ask for the lock to be released. The reading decides when it is. */
  release: () => void;
  /** True while either request is in flight. */
  busy: boolean;
  /**
   * The backend's sentence for the last request it refused, verbatim, or
   * null. Never a success message — the button's own face says engaged.
   */
  notice: string | null;
}

export const EstopContext = React.createContext<ConsoleEstop | null>(null);

export function useConsoleEstop(): ConsoleEstop {
  const value = React.useContext(EstopContext);
  if (!value) {
    throw new Error("useConsoleEstop must be used inside <EstopProvider>.");
  }
  return value;
}

/**
 * The sentence a command hook throws while the stop is engaged, so the refusal
 * reaches the screen by the same route a backend one does.
 */
export const ESTOP_REFUSAL =
  "Emergency stop is engaged. Hold the stop button to release it before sending the robot anywhere.";
