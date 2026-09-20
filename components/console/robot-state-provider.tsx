"use client";

import * as React from "react";

import { RobotStateContext } from "@/hooks/use-console-robot-state";
import { useRobotState } from "@/hooks/use-robot-state";

/**
 * Holds the console's single GET /api/v1/robot/state poll, mounted once in the
 * root layout so it survives route changes. Before this existed every screen
 * called useRobotState() itself, which meant the header and the page each ran
 * their own interval against a 1 Hz topic and could show different frames.
 *
 * The context this fills and the `useConsoleRobotState` that reads it live in
 * hooks/use-console-robot-state.ts, because hooks read them too and a hook may
 * not import from this directory. What is left here is the part that is
 * genuinely a component: mounting the poll and putting its value on the tree.
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
