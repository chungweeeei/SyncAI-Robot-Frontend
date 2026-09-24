"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import {
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  type ScheduleDraft,
  type ScheduleState,
  type ScheduleTrigger,
} from "@/lib/api/schedule";
import { scheduleTaskTemplate } from "@/lib/api/task-template";
import { soonestUpcomingRun } from "@/lib/task/schedule";

export type SchedulesStatus = "loading" | "ok" | "error";

/**
 * How long to wait before re-reading the list after a pause / resume.
 *
 * Measured against a live backend: `POST .../pause` answers 200, but the very
 * next `GET /api/v1/schedules` still reports `paused: false` — Temporal's
 * describe lags the patch by a second or two. An immediate refresh therefore
 * shows the row exactly as it was, and the operator concludes the button did
 * nothing. Create and delete do *not* have this lag (a created schedule is in the
 * next list, a deleted one is gone), which is why only these two settle.
 */
const PAUSE_SETTLE_MS = 2000;

/**
 * How long after a schedule's run time to re-read the list. Temporal starts the
 * run and only then recomputes `next_run_times`, so a read at the exact second
 * can still report the run it has just fired; the few seconds are for that.
 */
const FIRE_SETTLE_MS = 5000;

/**
 * The longest a fire timer is set for. `setTimeout` holds its delay in a signed
 * 32-bit int, and anything past ~24.8 days overflows and fires *at once* — a
 * weekly schedule is fine, but one Temporal reports months out would otherwise
 * re-read in a tight loop. Waking once a day and re-arming costs nothing.
 */
const MAX_FIRE_WAIT_MS = 86_400_000;

export interface UseSchedules {
  schedules: ScheduleState[];
  /**
   * The epoch ms each row's next run is measured from (see `upcomingRun`).
   * State rather than a `Date.now()` in render so that it moves exactly when
   * the fire timer does, and the readout changes with the re-read it goes with.
   */
  now: number;
  status: SchedulesStatus;
  /** The load failure, or the most recent write failure. Rendered verbatim. */
  error: string | null;
  /** True while a create / pause / resume / delete is in flight. */
  busy: boolean;
  /** True when the schedule was registered. */
  create: (draft: ScheduleDraft) => Promise<boolean>;
  pause: (id: string) => Promise<boolean>;
  resume: (id: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  refresh: () => void;
  clearError: () => void;
}

/**
 * The schedules registered on this robot, written through on every change.
 *
 * Shaped after useMapVertices, with two deliberate differences.
 *
 * Every mutation ends in a refresh, success or failure, and the authoritative
 * list always comes from the backend. useMapVertices splices because its POST/PUT
 * response *is* the stored row; here the responses are a bare `{id, message}`,
 * and `next_run_times` is computed by Temporal — when a resumed schedule fires
 * next is knowable only by asking. Refreshing after a *failure* too is what makes
 * a 404 from DELETE (Temporal had already dropped it) resolve into the row
 * disappearing, rather than sitting there next to an error about it. The one local
 * write is the optimistic paused flag, and PAUSE_SETTLE_MS explains why.
 *
 * Write failures live in the mutations rather than the query, and the
 * refresh-on-every-write above is the reason: a rejected create triggers a
 * reload that *succeeds*, and if the failure lived where the query keeps its
 * error, that success would clear the very sentence the operator needs to read.
 * Splitting them, and preferring the write, is what makes "Schedule X already
 * exists" survive the reload that follows it.
 *
 * There is no poll. `next_run_times` moves on the minute at best, while the list
 * endpoint costs a Temporal list RPC plus a memo decode per schedule — a 1 Hz
 * poll would spend a request a second on data that changes hourly. But the list
 * *does* change on its own at one knowable moment: when a schedule fires, and
 * Temporal moves its next run along. So there is one timer, set for the soonest
 * run in the list, which re-reads then and re-arms from the answer. With no
 * timer at all, a page left open showed a run that had already happened as the
 * next one until something else happened to refresh it.
 */
export function useSchedules(): UseSchedules {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.schedules,
    queryFn: ({ signal }) => listSchedules(signal),
  });

  const refresh = React.useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.schedules }),
    [queryClient],
  );

  const [now, setNow] = React.useState(() => Date.now());

  /**
   * Armed from `now` rather than from the wall clock, so a re-read that still
   * lists the run just fired (see FIRE_SETTLE_MS) aims at the one after it
   * instead of re-arming on the past run and reading in a loop. Re-armed on
   * every answer, which is what makes a create, resume or delete move it too.
   */
  const data = query.data;
  React.useEffect(() => {
    if (!data) return;
    const soonest = soonestUpcomingRun(data, now);
    if (soonest === null) return;
    const wait = Math.min(
      Math.max(soonest + FIRE_SETTLE_MS - Date.now(), 0),
      MAX_FIRE_WAIT_MS,
    );
    const timer = window.setTimeout(() => {
      setNow(Date.now());
      refresh();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [data, now, refresh]);

  /**
   * The pending settle refresh, so it can be cleared on unmount and so a second
   * pause inside the window replaces the timer rather than stacking one.
   */
  const settleRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    },
    [],
  );

  /**
   * Pause / resume: flip the row in the cache, then reconcile once Temporal has
   * caught up. The optimistic flip is what makes the button feel like it did
   * something during the PAUSE_SETTLE_MS window, and it is safe to trust because
   * the write already returned 200 — this is a display lag, not an unconfirmed
   * write. A failure skips the flip and refreshes at once, so the row snaps back.
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

  const createMutation = useMutation({
    mutationFn: (draft: ScheduleDraft) => createSchedule(draft),
    onSettled: refresh,
  });
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

  const { mutateAsync: createAsync } = createMutation;
  const { mutateAsync: removeAsync } = removeMutation;
  const { mutateAsync: pauseAsync } = pauseMutation;
  const { mutateAsync: resumeAsync } = resumeMutation;

  // Rejections are swallowed rather than rethrown because every caller is wired
  // straight to an onClick — a rethrow would be an unhandled rejection, and the
  // components read the outcome off `error` and the returned boolean.
  const create = React.useCallback(
    (draft: ScheduleDraft) => createAsync(draft).then(ok, no),
    [createAsync],
  );
  const pause = React.useCallback((id: string) => pauseAsync(id).then(ok, no), [pauseAsync]);
  const resume = React.useCallback(
    (id: string) => resumeAsync(id).then(ok, no),
    [resumeAsync],
  );
  const remove = React.useCallback((id: string) => removeAsync(id).then(ok, no), [removeAsync]);

  const write = writeState([createMutation, pauseMutation, resumeMutation, removeMutation]);
  const { reset: resetCreate } = createMutation;
  const { reset: resetPause } = pauseMutation;
  const { reset: resetResume } = resumeMutation;
  const { reset: resetRemove } = removeMutation;
  const clearError = React.useCallback(() => {
    resetCreate();
    resetPause();
    resetResume();
    resetRemove();
  }, [resetCreate, resetPause, resetResume, resetRemove]);

  return {
    schedules: query.data ?? [],
    now,
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    error: write.error ?? query.error?.message ?? null,
    busy: write.busy,
    create,
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
 * One schedule, **including its frozen step list** — the per-row describe the
 * list endpoint cannot afford (see lib/api/schedule.ts).
 *
 * Fetched on a deliberate gesture — the caller mounts this when the row is
 * expanded — so the extra RPC is paid once, for the one schedule the operator
 * asked about. Under its own key rather than the list's so that the list's
 * refresh-on-every-write does not re-describe every open row.
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
 * resolution into a schedule.
 *
 * A separate hook from useSchedules' `create`, because it is a different path
 * on purpose: it re-resolves server-side, records the provenance in the
 * schedule memo (so the row can later be told it has gone stale), and refuses
 * an unattended run against another map or a deleted vertex. The list is
 * re-read on success like every other schedule write. On a refusal the
 * template library is re-read too — the reason is a `vertex_status` or a
 * `map_matches_active` the rows may be showing stale.
 */
export function useScheduleTaskTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ templateId, scheduleId, trigger }: ScheduleTaskTemplateVariables) =>
      scheduleTaskTemplate(templateId, scheduleId, trigger),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.schedules });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });
}
