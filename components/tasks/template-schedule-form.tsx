"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScheduleForm } from "@/components/tasks/schedule-form";
import { useScheduleTaskTemplate } from "@/hooks/use-schedules";
import type { TaskTemplate } from "@/lib/api/task-template";

/**
 * Put a saved task on a schedule, in a dialog over the card it was pressed
 * on: inline, the form opened in a list further down the page, away from the
 * task it was for.
 *
 * Only a saved task, always through /task_templates/{id}/schedule: it
 * re-resolves the waypoints server-side, records the provenance the card
 * groups its schedules by, and refuses another map or a deleted waypoint, so
 * the card's own map gate is a courtesy.
 */
export function TemplateScheduleDialog({
  template,
  existingIds,
  onScheduled,
  onClose,
}: {
  /** The task to schedule; null closes the dialog. */
  template: TaskTemplate | null;
  existingIds: readonly string[];
  /** After the schedule is registered; the list re-reads itself. */
  onScheduled: () => void;
  onClose: () => void;
}) {
  const schedule = useScheduleTaskTemplate();
  const { reset } = schedule;

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => {
        if (open || schedule.isPending) return;
        reset();
        onClose();
      }}
    >
      <DialogContent closeLabel="Cancel scheduling">
        <DialogHeader>
          <DialogTitle>Schedule {template?.name}</DialogTitle>
          <DialogDescription>
            Scheduling a saved task locks in today&apos;s waypoint positions. Moving
            a waypoint later will not change what the schedule runs.
          </DialogDescription>
        </DialogHeader>
        {template && (
          <ScheduleForm
            // One form per task: another task's dialog starts a fresh one.
            key={template.id}
            existingIds={existingIds}
            ready
            reason={null}
            busy={schedule.isPending}
            error={schedule.error?.message ?? null}
            onSubmit={(scheduleId, trigger) =>
              schedule.mutate(
                { templateId: template.id, scheduleId, trigger },
                {
                  onSuccess: () => {
                    reset();
                    onScheduled();
                  },
                },
              )
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
