"use client";

import { Chip, type Tone } from "@/components/console/instrument";
import type { TaskStatus } from "@/lib/api/task";

// A task in flight is active guidance, which is what magenta means everywhere
// else in the console; a finished one is just a measured outcome.
//
// CANCELED is caution, not neutral: a job that did not finish left the robot
// short of where it was sent, which is worth a second look in the history
// even when someone stopped it on purpose. It stays short of FAILED's red,
// because nothing went wrong.
//
// Exported for the one surface that cannot use TaskStatusChip itself: the
// status strip has no room for "IN PROGRESS" and renders its own shorter label.
// It borrows the tone from here so a running task cannot end up one colour in
// the masthead and another on /tasks.
export const STATUS_TONE: Record<TaskStatus, Tone> = {
  PENDING: "cmd",
  IN_PROGRESS: "active",
  COMPLETED: "live",
  FAILED: "warn",
  CANCELED: "caution",
};

/**
 * A submitted task's status. Shared by every flow that dispatches one — the nav
 * goal and posture overlays on the dashboard, and both the task-level and the
 * per-step readback on /tasks — so the same workflow state reads the same colour
 * wherever the operator meets it.
 *
 * It lives beside instrument.tsx rather than under components/dashboard/ for
 * that reason: three routes read it, and the dashboard folder is route-scoped.
 */
export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <Chip tone={STATUS_TONE[status]}>{status.replace("_", " ")}</Chip>;
}
