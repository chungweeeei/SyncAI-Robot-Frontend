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
  /** This tab's latch, or the robot reporting ESTOP — see `estopEngaged`. */
  engaged: boolean;
  /**
   * Only this tab's latch. Release clears it; it cannot clear a stop the robot
   * reports, so the button keeps saying engaged while that reading stands.
   */
  latched: boolean;
  /** Latch, then send the stop. Synchronous to the latch, never waits. */
  engage: () => void;
  /** Clear this tab's latch. Sends nothing — see the provider. */
  release: () => void;
  /** True while the stop's requests are in flight. */
  busy: boolean;
  /**
   * What the operator needs told about the last press, or null: the backend's
   * refusals, or that the motors were not stopped. Never a success message —
   * the button's own face says engaged.
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
