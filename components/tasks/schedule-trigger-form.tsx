"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import { ScheduleForm } from "@/components/tasks/schedule-form";
import { useUpdateScheduleTrigger } from "@/hooks/use-schedules";
import type { ScheduleState } from "@/lib/api/schedule";

/**
 * Change when a registered schedule fires, inside its own row. The backend
 * swaps the trigger in place, keeping the name, frozen steps, source and
 * pause; only the trigger is editable.
 */
export function ScheduleTriggerForm({
  schedule,
  onDone,
}: {
  schedule: ScheduleState;
  /** After the edit is accepted, or on cancel. */
  onDone: () => void;
}) {
  const update = useUpdateScheduleTrigger();

  return (
    <div className="mt-2 space-y-2 rounded-sm border border-signal-cmd/40 bg-signal-cmd/6 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="instrument-label min-w-0 truncate text-signal-cmd">
          Edit {schedule.id}
        </p>
        <button
          type="button"
          onClick={onDone}
          aria-label="Cancel editing"
          title="Cancel editing"
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      </div>
      <ScheduleForm
        existingIds={[]}
        ready
        reason={null}
        busy={update.isPending}
        error={update.error?.message ?? null}
        editing={{ id: schedule.id, trigger: schedule.trigger }}
        onSubmit={(id, trigger) => update.mutate({ id, trigger }, { onSuccess: onDone })}
      />
      <p className="text-[11px] leading-tight text-muted-foreground">
        Only the time changes. The schedule keeps the waypoint positions it
        locked in{schedule.paused ? ", and stays paused" : ""}.
      </p>
    </div>
  );
}
