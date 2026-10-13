"use client";

import * as React from "react";

/**
 * The console's emergency stop, as a context: the drive panel disarms on it
 * and the command hooks refuse while it is engaged. The provider is
 * components/console/estop-provider.tsx.
 */
export interface ConsoleEstop {
  /** The robot's safety lock, or this tab's unanswered press (see `estopEngaged`). */
  engaged: boolean;
  /** A release has been sent and has not been answered yet. */
  releasing: boolean;
  /** Hold the controls, then ask for the lock. Never waits on the answer. */
  engage: () => void;
  /** Ask for the lock to be released. The reading decides when it is. */
  release: () => void;
  busy: boolean;
  /** The backend's sentence for the last refused request; never a success. */
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

/** Thrown by a command hook while the stop is engaged, reaching the screen like a backend refusal. */
export const ESTOP_REFUSAL =
  "Emergency stop is engaged. Hold the stop button to release it before sending the robot anywhere.";
