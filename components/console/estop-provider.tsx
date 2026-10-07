"use client";

import * as React from "react";

import { EstopContext, type ConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useEstop } from "@/hooks/use-estop";
import { isTypingTarget } from "@/lib/keyboard";
import { estopEngaged, requestAfterReading } from "@/lib/robot/estop";

/**
 * Holds the emergency stop for the whole console, mounted once in the root
 * layout so a press survives a route change.
 *
 * **What is engaged is the robot's reading.** The driver's safety lock
 * (`low_level_mode.safety_locked`) is the stop; this tab's press only covers
 * the gap before the robot reports it, holding the drive panel and the
 * command hooks from the instant of the press. Once the reading says locked
 * the press is dropped (`requestAfterReading`) and the reading alone decides,
 * so a lock released from another console reads as released here as well.
 * Nothing is stored: a reload reads the lock off the robot like everything
 * else.
 *
 * **Release waits for the reading too.** A held press sends the release, and
 * the button stays engaged until the robot reports the lock off — a release
 * shown before the driver acted would be the one way this control could
 * say "safe to move" falsely. Releasing restarts nothing: standing up or
 * driving is the operator's next, separate act.
 *
 * The cancels are the backend's: it cancels every running job on the lock's
 * rising edge, whoever engaged it, so this console sends none of its own.
 *
 * The keyboard shortcut is Shift+Space, on the window and here only, so there
 * is exactly one listener for it. Shift because a bare Space already belongs
 * to the floor plan editor's pan and to every focused button; and it engages
 * only, never releases, so a shortcut pressed twice cannot undo itself.
 */
export function EstopProvider({ children }: { children: React.ReactNode }) {
  const { state } = useConsoleRobotState();
  const locked = state?.low_level_mode.safety_locked ?? null;
  const [requested, setRequested] = React.useState(false);
  // A render-time adjust rather than an effect, as useLocomotion does with
  // its controller: an effect would leave one frame on a request the reading
  // has already answered. It settles because the rule hands back the same
  // value once nothing changes.
  const afterReading = requestAfterReading(requested, locked);
  if (afterReading !== requested) setRequested(afterReading);

  const engaged = estopEngaged(requested, locked);
  const estop = useEstop();
  const { mutate, reset } = estop;

  const engage = React.useCallback(() => {
    setRequested(true);
    mutate(true, {
      // Nothing was locked: the driver could not be reached. The press stops
      // holding the controls, and the refusal says why.
      onError: () => setRequested(false),
    });
  }, [mutate]);

  const release = React.useCallback(() => {
    reset();
    mutate(false, {
      // A press the reading never confirmed (a driver that has not published
      // yet) has nothing to hand over to; the release is what ends it.
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
