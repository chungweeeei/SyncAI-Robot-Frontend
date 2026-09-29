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
 * How long to wait before re-reading the list after a pause / resume.
 *
 * Measured against a live backend: `POST .../pause` answers 200, but the very
 * next `GET /api/v1/schedules` still reports `paused: false` — Temporal's
 * describe lags the patch by a second or two. An immediate refresh therefore
 * shows the row exactly as it was, and the operator concludes the button did
 * nothing. Create and a trigger edit wait for the list too, but through
 * `settleSchedules` below, which can tell when the write has arrived.
 */
const PAUSE_SETTLE_MS = 2000;

/** How often, and how many times, `settleSchedules` re-reads the list. */
const SETTLE_STEP_MS = 500;
const SETTLE_ATTEMPTS = 10;

/**
 * Re-read the list after a write until it shows that write, then hand it to
 * the cache.
 *
 * The list comes from Temporal's visibility store, which is a second or two
 * behind a create or an edit. A single refresh after either therefore raced
 * it: a new schedule was missing until the next read, which is a day away
 * when nothing else is due, and an edited row read back its old trigger. So
 * the first read goes out at once and the reads repeat until `shows` says the
 * write is there. A read that does not yet show it never reaches the cache —
 * that is what keeps an edited row from flipping back to its old rule
 * mid-wait. Past the last attempt, the list is taken as it is: it is still the
 * backend's word, and the operator's Refresh stays the escape hatch.
 *
 * Outside any component on purpose, so the reads still land after the form
 * that made the write has closed.
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
   * When this snapshot was read, in epoch ms — what a row measures "next"
   * against (see `upcomingRun`). The read time rather than `Date.now()` in
   * render, so the readout is a pure function of the data it came with and
   * moves exactly when the list does.
   */
  readAtMs: number;
  status: SchedulesStatus;
  /** The load failure, or the most recent write failure. Rendered verbatim. */
  error: string | null;
  /**
   * True while a pause / resume / delete is in flight. Registering one is
   * useScheduleTaskTemplate: a schedule is only ever made from a saved job,
   * so the loose-steps POST /api/v1/schedules this hook used to wrap has no
   * caller.
   */
  busy: boolean;
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
 * There is no poll. `next_run_times` moves only when a schedule fires, while
 * the list endpoint costs a Temporal list RPC plus a memo decode per schedule —
 * a 1 Hz poll would spend a request a second on data that changes hourly. But
 * the moment it moves is in the data itself, so the interval is *derived*: one
 * read just after the soonest run, and the answer sets the next one
 * (nextScheduleRefetchMs). Before this the row kept showing a time that had
 * passed until someone pressed Refresh, which still exists as the escape hatch.
 * The interval is measured from the snapshot's own `dataUpdatedAt` so that it
 * is the same number on every render — the library restarts the timer when the
 * number changes, and this screen re-renders with the 2 s job poll. The read
 * goes ahead in a hidden tab too: the library would otherwise skip that tick
 * and wait a whole interval more, and one request at fire time is cheap.
 *
 * The interval alone does not keep a row true, which is why `readAtMs` goes out
 * with the list: between the run and the read that follows it — and after that
 * read too, while Temporal's describe still reports the run it has just
 * started — the head of `next_run_times` is a time that has passed, and
 * `upcomingRun` is what steps over it.
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

  // Rejections are swallowed rather than rethrown because every caller is wired
  // straight to an onClick — a rethrow would be an unhandled rejection, and the
  // components read the outcome off `error` and the returned boolean.
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
 * an unattended run against another map or a deleted vertex. On success the
 * list is re-read until the new schedule is in it (settleSchedules), so its
 * row appears without a Refresh. On a refusal the template library is re-read
 * too — the reason is a `vertex_status` or a `map_matches_active` the rows may
 * be showing stale.
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
 * PATCH /api/v1/schedules/{id} — change when a registered schedule fires.
 *
 * Its own mutation rather than a verb on useSchedules, like
 * useScheduleTaskTemplate: the edit form shows its own refusal under its own
 * fields, and a failure here should not become the list's error line.
 *
 * The row is patched in the cache on success, the same way pause flips it:
 * the write already returned 200, so the new trigger is a fact. Its
 * `next_run_times` is cleared rather than kept — those were computed from the
 * rule just replaced, and "—" is honest where a stale time would not be. Then
 * the list is re-read until it carries the new trigger (settleSchedules), which
 * is what brings the next run in, without a read of the old rule ever
 * overwriting the patch. A row that is gone by then counts as settled: someone
 * deleted it, and the list should say so. The expanded row's describe carries
 * the trigger too, so it is dropped. A failure re-reads at once: a 404 is a
 * schedule someone else deleted, and the row should go rather than sit beside
 * the error.
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
