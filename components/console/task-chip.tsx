"use client";

import { Chip, type Tone } from "@/components/console/instrument";
import type { TaskStatus } from "@/lib/api/task";

// In flight is active guidance (magenta); finished is a measured outcome.
// CANCELED and PAUSED are caution, not neutral: the robot is short of where
// it was sent, worth a second look though nothing went wrong.
//
// Exported for the status strip, which draws its own shorter label but must
// use the same colour as /tasks.
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  PENDING: "cmd",
  IN_PROGRESS: "active",
  PAUSED: "caution",
  PAUSING: "caution",
  COMPLETED: "live",
  FAILED: "warn",
  CANCELED: "caution",
};

/**
 * A submitted task's status, shared by every flow that dispatches one so a
 * state reads the same colour everywhere. In console/ since three routes use it.
 */
export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{status.replace("_", " ")}</Chip>;
}
