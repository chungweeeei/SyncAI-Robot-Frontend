"use client";

import * as React from "react";

import { RobotStateContext } from "@/hooks/use-console-robot-state";
import { useRobotState } from "@/hooks/use-robot-state";

/**
 * The console's single GET /api/v1/robot/state poll, mounted once in the root
 * layout, so every surface shows the same frame.
 *
 * The context and `useConsoleRobotState` live in
 * hooks/use-console-robot-state.ts, since hooks read them and may not import
 * from components/.
 */
export function RobotStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useRobotState();

  return (
    <RobotStateContext.Provider value={value}>
      {children}
    </RobotStateContext.Provider>
  );
}
