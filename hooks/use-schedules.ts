"use client";

import * as React from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import {
  deleteSchedule,
  getSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  updateScheduleTrigger,
  type ScheduleState,
  type ScheduleTrigger,
} from "@/lib/api/schedule";
import { scheduleTaskTemplate } from "@/lib/api/task-template";
import { nextScheduleRefetchMs, sameTrigger } from "@/lib/task/schedule";

export type SchedulesStatus = "loading" | "ok" | "error";

/**
 * Delay before re-reading the list after a pause / resume. Temporal's describe
 * lags the 200 by a second or two, so an immediate refresh shows the row
 * unchanged and the button looks dead. Create and trigger edits use
 * `settleSchedules` instead, which can tell when the write has arrived.
 */
const PAUSE_SETTLE_MS = 2000;

const SETTLE_STEP_MS = 500;
const SETTLE_ATTEMPTS = 10;

/**
 * Re-read the list until it shows a write, then hand it to the cache.
 *
 * Temporal's visibility store trails a create or edit by a second or two, so a
 * single refresh raced it: a new schedule stayed missing until the next read
 * (possibly a day away) and an edited row read back its old trigger. A read
 * that does not yet show the write never reaches the cache, so the row cannot
 * flip back mid-wait; after the last attempt the list is taken as is.
 *
 * Outside any component so the reads still land after the form has closed.
 */
async function settleSchedules(
  queryClient: QueryClient,
  shows: (list: ScheduleState[]) => boolean,
): Promise<void> {
  for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
    let list: ScheduleState[];
    try {
      list = await listSchedules();
    } catch {
      // The query's own read reports the failure; it is not this loop's to show.
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
      return;
    }
    if (shows(list) || attempt === SETTLE_ATTEMPTS) {
      // A read already in flight started before the write settled; landing
      // after this one, it would put the old list back.
      await queryClient.cancelQueries({ queryKey: queryKeys.schedules });
      queryClient.setQueryData(queryKeys.schedules, list);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, SETTLE_STEP_MS));
  }
}

export interface UseSchedules {
  schedules: ScheduleState[];
  /**
   * When this snapshot was read (epoch ms), what `upcomingRun` measures
   * against — not `Date.now()`, so the readout moves only with the list.
   */
  readAtMs: number;
  status: SchedulesStatus;
  /** The load failure or the latest write failure, rendered verbatim. */
  error: string | null;
  /**
   * True while a pause / resume / delete is in flight. Creating one is
   * useScheduleTaskTemplate: a schedule is only ever made from a saved job.
   */
  busy: boolean;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  refresh: () => void;
  clearError: () => void;
}

/**
 * The schedules registered on this robot.
 *
 * Every write ends in a refresh, success or failure: the responses are a bare
 * `{id, message}` and `next_run_times` is Temporal's to compute, so the list
 * always comes from the backend. Refreshing after a failure is what turns a
 * DELETE 404 (already gone) into the row disappearing. The one local write is
 * the optimistic paused flag (see PAUSE_SETTLE_MS).
 *
 * Write failures live on the mutations, not the query, because the refresh
 * after a rejected write *succeeds* and would otherwise clear the sentence the
 * operator needs to read.
 *
 * No poll — the list is a Temporal RPC plus a memo decode per row. The
 * interval is derived from the soonest run instead (nextScheduleRefetchMs),
 * measured from `dataUpdatedAt` so it is the same number on every render (the
 * library restarts the timer when it changes). It runs in a hidden tab too, or
 * the library would skip that tick for a whole interval. Between a run and the
 * read after it the head of `next_run_times` has passed; `upcomingRun` steps
 * over it using `readAtMs`.
 */
export function useSchedules(): UseSchedules {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.schedules,
    queryFn: ({ signal }) => listSchedules(signal),
    refetchInterval: (query) =>
      nextScheduleRefetchMs(query.state.data ?? [], query.state.dataUpdatedAt),
    refetchIntervalInBackground: true,
  });

  const refresh = React.useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.schedules }),
    [queryClient],
  );

  /** The pending settle refresh: cleared on unmount, replaced (not stacked) by a second pause. */
  const settleRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  /**
   * Flip the row in the cache, then reconcile once Temporal catches up. Safe
   * because the write already returned 200 — a display lag, not an unconfirmed
   * write. A failure skips the flip and refreshes at once.
   */
  const settlePaused = React.useCallback(
    (id: string, paused: boolean) => {
      queryClient.setQueryData<ScheduleState[]>(queryKeys.schedules, (current) =>
        current?.map((entry) => (entry.id === id ? { ...entry, paused } : entry)),
      );
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        settleRef.current = null;
        refresh();
      }, PAUSE_SETTLE_MS);
    },
    [queryClient, refresh],
  );

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSettled: refresh,
  });
  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseSchedule(id),
    onSuccess: (_result, id) => settlePaused(id, true),
    onError: refresh,
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeSchedule(id),
    onSuccess: (_result, id) => settlePaused(id, false),
    onError: refresh,
  });

  const { mutateAsync: removeAsync } = removeMutation;
  const { mutateAsync: pauseAsync } = pauseMutation;
  const { mutateAsync: resumeAsync } = resumeMutation;

  // Rejections are swallowed: every caller is an onClick, which reads `error`
  // and the boolean, and a rethrow would be an unhandled rejection.
  const pause = React.useCallback((id: string) => pauseAsync(id).then(ok, no), [pauseAsync]);
  const resume = React.useCallback(
    (id: string) => resumeAsync(id).then(ok, no),
    [resumeAsync],
  );
  const remove = React.useCallback((id: string) => removeAsync(id).then(ok, no), [removeAsync]);

  const write = writeState([pauseMutation, resumeMutation, removeMutation]);
  const { reset: resetPause } = pauseMutation;
  const { reset: resetResume } = resumeMutation;
  const { reset: resetRemove } = removeMutation;
  const clearError = React.useCallback(() => {
    resetPause();
    resetResume();
    resetRemove();
  }, [resetPause, resetResume, resetRemove]);

  return {
    schedules: query.data ?? [],
    readAtMs: query.dataUpdatedAt,
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    error: write.error ?? query.error?.message ?? null,
    busy: write.busy,
    pause,
    resume,
    remove,
    refresh,
    clearError,
  };
}

const ok = () => true;
const no = () => false;

export interface UseSchedule {
  /** The schedule with its frozen steps, or null until the describe answers. */
  schedule: ScheduleState | null;
  status: SchedulesStatus;
}

/**
 * One schedule including its frozen step list — the per-row describe the list
 * endpoint cannot afford. Mounted when a row is expanded, and under its own key
 * so the list's refresh-on-every-write does not re-describe every open row.
 */
export function useSchedule(id: string): UseSchedule {
  const query = useQuery({
    queryKey: queryKeys.schedule(id),
    queryFn: ({ signal }) => getSchedule(id, signal),
  });

  return {
    schedule: query.data ?? null,
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
  };
}

export interface ScheduleTaskTemplateVariables {
  templateId: string;
  scheduleId: string;
  trigger: ScheduleTrigger;
}

/**
 * POST /api/v1/task_templates/{id}/schedule — freeze a template's current
 * resolution into a schedule. The backend re-resolves, records provenance in
 * the memo, and refuses a run against another map or a deleted vertex.
 *
 * On success the list is settled until the new row is in it. On a refusal the
 * template library is re-read: the reason is a `vertex_status` or
 * `map_matches_active` its rows may show stale.
 */
export function useScheduleTaskTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, scheduleId, trigger }: ScheduleTaskTemplateVariables) =>
      scheduleTaskTemplate(templateId, scheduleId, trigger),
    onSuccess: (_result, { scheduleId }) => {
      void settleSchedules(queryClient, (list) =>
        list.some((entry) => entry.id === scheduleId),
      );
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });
}

export interface UpdateScheduleTriggerVariables {
  id: string;
  trigger: ScheduleTrigger;
}

/**
 * PATCH /api/v1/schedules/{id} — change when a schedule fires. Its own
 * mutation so the refusal shows under the edit form, not as the list's error.
 *
 * On success the row is patched (the 200 makes the trigger a fact) with
 * `next_run_times` cleared, since those came from the replaced rule. The list
 * is then settled until it carries the new trigger; a row gone by then counts
 * as settled (someone deleted it). A failure re-reads at once, so a 404'd row
 * goes rather than sitting beside the error.
 */
export function useUpdateScheduleTrigger() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trigger }: UpdateScheduleTriggerVariables) =>
      updateScheduleTrigger(id, trigger),
    onSuccess: (_result, { id, trigger }) => {
      queryClient.setQueryData<ScheduleState[]>(queryKeys.schedules, (current) =>
        current?.map((entry) =>
          entry.id === id ? { ...entry, trigger, next_run_times: [] } : entry,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedule(id) });
      void settleSchedules(queryClient, (list) => {
        const row = list.find((entry) => entry.id === id);
        return !row || sameTrigger(row.trigger, trigger);
      });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
    },
  });
}
