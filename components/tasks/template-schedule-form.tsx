"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import { ScheduleForm } from "@/components/tasks/schedule-form";
import { useScheduleTaskTemplate } from "@/hooks/use-schedules";
import type { TaskTemplate } from "@/lib/api/task-template";

/**
 * Register a saved job on a schedule, at the top of the list it will join.
 *
 * This used to be a pane in the task editor, which could also schedule steps
 * that were never saved. Those schedules named no template, so no row could
 * show them and the stale check could not reach them; the editor had to carry
 * a paragraph warning about it. Here only a saved job can be scheduled, and
 * always through /task_templates/{id}/schedule: it re-resolves the waypoints
 * server-side, records the provenance the row's clock chip and stale badge
 * read, and refuses an unattended run on another map or a deleted waypoint —
 * so the row's own gate on the map is a courtesy, not the only guard.
 *
 * Inline rather than a modal, like every other form in this console.
 */
export function TemplateScheduleForm({
  template,
  existingIds,
  onScheduled,
  onCancel,
}: {
  template: TaskTemplate;
  existingIds: readonly string[];
  /** After the schedule is registered; the list re-reads itself. */
  onScheduled: () => void;
  onCancel: () => void;
}) {
  const schedule = useScheduleTaskTemplate();
  const frame = React.useRef<HTMLDivElement>(null);

  // Brought into view when it opens: the row's Schedule button is up in the
  // library, and a form that appeared off screen would read as a button that
  // did nothing. Scrolling is DOM work with nothing to set, so an effect.
  React.useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, []);

  return (
    <div
      ref={frame}
      className="mb-3 space-y-2 rounded-sm border border-signal-cmd/40 bg-signal-cmd/6 p-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="instrument-label min-w-0 truncate text-signal-cmd">
          Schedule {template.name}
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel scheduling"
          title="Cancel scheduling"
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      </div>
      <ScheduleForm
        existingIds={existingIds}
        ready
        reason={null}
        busy={schedule.isPending}
        error={schedule.error?.message ?? null}
        onSubmit={(scheduleId, trigger) =>
          schedule.mutate(
            { templateId: template.id, scheduleId, trigger },
            { onSuccess: onScheduled },
          )
        }
      />
      <p className="text-[11px] leading-tight text-muted-foreground">
        Scheduling a saved job locks in today&apos;s waypoint positions. Moving a
        waypoint later will not change what the schedule runs.
      </p>
    </div>
  );
}
