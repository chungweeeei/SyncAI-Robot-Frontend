"use client";

import * as React from "react";

import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { EstopContext, type ConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useEstop } from "@/hooks/use-estop";
import { isTypingTarget } from "@/lib/keyboard";
import { estopEngaged } from "@/lib/robot/estop";

/**
 * Said when the stop went out but the robot's side held the motor stop back.
 * The job and the drive did stop, and the operator has to know the motors did
 * not — a robot still standing is not one that has been made safe.
 */
const NOT_FORWARDED =
  "The job and manual drive were stopped, but this robot does not accept an emergency stop from the console yet. Its motors are still powered.";

/**
 * Holds the emergency stop for the whole console, mounted once in the root
 * layout so the latch survives a route change — a stop that lifted itself
 * because the operator opened another screen would be no stop at all.
 *
 * **The latch is a request, not a reading.** It is this tab's: it holds the
 * drive panel and the command hooks from the moment of the press, whatever the
 * robot answers, and it is not stored, so a reload starts released. A reload
 * that came back engaged with nothing on the robot saying so would claim a
 * stop that nothing enforces; the robot's own ESTOP reading is what carries
 * across a reload, and `estopEngaged` folds it in.
 *
 * **Release sends nothing.** It clears the latch and lets the controls arm
 * again; standing the robot up or driving it is a separate, deliberate act,
 * because a release that also restarted motion would make the long press a
 * way to move the robot.
 *
 * The keyboard shortcut is Shift+Space, on the window and here only, so there
 * is exactly one listener for it. Shift because a bare Space already belongs
 * to the floor plan editor's pan and to every focused button; and it engages
 * only, never releases, so a shortcut pressed twice cannot undo itself.
 */
export function EstopProvider({ children }: { children: React.ReactNode }) {
  const { state } = useConsoleRobotState();
  const { tasks } = useConsoleActiveTasks();
  const [latched, setLatched] = React.useState(false);
  const estop = useEstop();

  const engaged = estopEngaged(latched, state?.low_level_mode.motion ?? null);

  const { mutate, reset } = estop;
  // Read at press time through a ref, so `engage` keeps one identity across
  // the 2 s active-list poll and the window listener is not re-added on it.
  const tasksRef = React.useRef(tasks);
  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const engage = React.useCallback(() => {
    setLatched(true);
    mutate(tasksRef.current.map((task) => task.id));
  }, [mutate]);

  const release = React.useCallback(() => {
    setLatched(false);
    reset();
  }, [reset]);

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

  const result = estop.data;
  const notice = estop.error
    ? estop.error.message
    : result
      ? [...result.refusals, ...(result.held ? [NOT_FORWARDED] : [])].join(" ") || null
      : null;

  const value = React.useMemo<ConsoleEstop>(
    () => ({ engaged, latched, engage, release, busy: estop.isPending, notice }),
    [engaged, latched, engage, release, estop.isPending, notice],
  );

  return <EstopContext.Provider value={value}>{children}</EstopContext.Provider>;
}
