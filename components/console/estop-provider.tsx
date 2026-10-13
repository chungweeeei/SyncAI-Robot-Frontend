"use client";

import * as React from "react";

import { EstopContext, type ConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useEstop } from "@/hooks/use-estop";
import { isTypingTarget } from "@/lib/keyboard";
import { estopEngaged, requestAfterReading } from "@/lib/robot/estop";

/**
 * The emergency stop for the whole console, mounted once in the root layout
 * so a press survives a route change.
 *
 * **What is engaged is the robot's reading** (`safety_locked`). This tab's
 * press only covers the gap until the robot reports it; then the reading
 * alone decides (`requestAfterReading`), so a release from another console
 * reads here too. Nothing is stored.
 *
 * **Release waits for the reading too**: showing it before the driver acted
 * would be the one way this control could falsely say "safe to move".
 * Releasing restarts nothing.
 *
 * The backend cancels every running job on the lock's rising edge, so this
 * console sends no cancels. Shift+Space engages (never releases), with this
 * the only listener; bare Space belongs to the editor's pan and to buttons.
 */
export function EstopProvider({ children }: { children: React.ReactNode }) {
  const { state } = useConsoleRobotState();
  const locked = state?.low_level_mode.safety_locked ?? null;
  const [requested, setRequested] = React.useState(false);
  // During render, not in an effect, so no frame shows a request the reading
  // already answered. It settles once the rule returns the same value.
  const afterReading = requestAfterReading(requested, locked);
  if (afterReading !== requested) setRequested(afterReading);

  const engaged = estopEngaged(requested, locked);
  const estop = useEstop();
  const { mutate, reset } = estop;

  const engage = React.useCallback(() => {
    setRequested(true);
    mutate(true, {
      // Nothing was locked; the refusal says why.
      onError: () => setRequested(false),
    });
  }, [mutate]);

  const release = React.useCallback(() => {
    reset();
    mutate(false, {
      // Ends a press the reading never confirmed.
      onSuccess: () => setRequested(false),
    });
  }, [mutate, reset]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !event.shiftKey || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      engage();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [engage]);

  const releasing = estop.isPending && estop.variables === false;
  const notice = estop.error?.message ?? null;

  const value = React.useMemo<ConsoleEstop>(
    () => ({ engaged, releasing, engage, release, busy: estop.isPending, notice }),
    [engaged, releasing, engage, release, estop.isPending, notice],
  );

  return <EstopContext.Provider value={value}>{children}</EstopContext.Provider>;
}
