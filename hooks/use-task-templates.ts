"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import {
  createTaskTemplate,
  deleteTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate,
  type TaskTemplate,
  type TaskTemplateChanges,
  type TaskTemplateDraft,
} from "@/lib/api/task-template";

export type TaskTemplatesStatus = "loading" | "ok" | "error";

export interface UseTaskTemplates {
  /** Every template on the robot, by name. Scoping is the caller's business. */
  templates: TaskTemplate[];
  status: TaskTemplatesStatus;
  /** The load failure, or the most recent write failure. Rendered verbatim. */
  error: string | null;
  /** True while a create / update / delete is in flight. */
  busy: boolean;
  /** The stored row, or null if the request failed (see `error`). */
  create: (draft: TaskTemplateDraft) => Promise<TaskTemplate | null>;
  update: (id: string, changes: TaskTemplateChanges) => Promise<TaskTemplate | null>;
  /** True when the row is gone. */
  remove: (id: string) => Promise<boolean>;
  /** Re-read, e.g. after a vertex moved on another screen. */
  refresh: () => void;
  clearError: () => void;
}

/**
 * The operator's library of re-dispatchable templates, written through on every
 * change.
 *
 * Shaped after useMapVertices rather than useSchedules, and the difference is the
 * response body: POST and PUT here answer with the stored row, so the list is
 * spliced instead of refetched — a GET would cost a round trip to learn nothing.
 * (useSchedules must refetch because its writes answer `{id, message}` and the
 * next run times are computed by Temporal.)
 *
 * `refresh` exists even though nothing here mutates behind our back, because
 * something else does: a stored MOVE step's coordinates are resolved server-side
 * against the vertex's *current* pose, so editing a vertex on /maps changes what
 * these rows say. The vertex hooks now mark this key stale themselves, so a
 * fresh mount re-reads; this is the in-page escape hatch for a long-open tab.
 * Write failures live in the mutations rather than the query, so the reload a
 * refresh triggers cannot clear a sentence the operator still needs to read.
 */
export function useTaskTemplates(): UseTaskTemplates {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.taskTemplates,
    queryFn: ({ signal }) => listTaskTemplates(signal),
  });

  const refresh = React.useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates }),
    [queryClient],
  );

  /** Rewrite the cached list; a no-op until the load has answered. */
  const setTemplates = React.useCallback(
    (next: (current: TaskTemplate[]) => TaskTemplate[]) => {
      queryClient.setQueryData<TaskTemplate[]>(
        queryKeys.taskTemplates,
        (current) => (current ? next(current) : current),
      );
    },
    [queryClient],
  );

  const createMutation = useMutation({
    mutationFn: (draft: TaskTemplateDraft) => createTaskTemplate(draft),
    onSuccess: (created) => {
      // Inserted in the server's order (name, then created_at) rather than
      // appended, so the row does not jump on the next refresh.
      setTemplates((current) => sortByName([...current, created]));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: TaskTemplateChanges }) =>
      updateTaskTemplate(id, changes),
    onSuccess: (updated, { id }) => {
      setTemplates((current) =>
        sortByName(
          current.map((template) => (template.id === id ? updated : template)),
        ),
      );
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteTaskTemplate(id),
    onSuccess: (_result, id) => {
      setTemplates((current) => current.filter((template) => template.id !== id));
    },
  });

  const { mutateAsync: createAsync } = createMutation;
  const { mutateAsync: updateAsync } = updateMutation;
  const { mutateAsync: removeAsync } = removeMutation;

  // Rejections are swallowed rather than rethrown because every caller is wired
  // straight to an onClick — a rethrow would be an unhandled rejection, and the
  // components read the outcome off `error` and the returned value.
  const create = React.useCallback(
    (draft: TaskTemplateDraft) => createAsync(draft).catch(() => null),
    [createAsync],
  );
  const update = React.useCallback(
    (id: string, changes: TaskTemplateChanges) =>
      updateAsync({ id, changes }).catch(() => null),
    [updateAsync],
  );
  const remove = React.useCallback(
    (id: string) =>
      removeAsync(id).then(
        () => true,
        () => false,
      ),
    [removeAsync],
  );

  const write = writeState([createMutation, updateMutation, removeMutation]);
  const { reset: resetCreate } = createMutation;
  const { reset: resetUpdate } = updateMutation;
  const { reset: resetRemove } = removeMutation;
  const clearError = React.useCallback(() => {
    resetCreate();
    resetUpdate();
    resetRemove();
  }, [resetCreate, resetUpdate, resetRemove]);

  return {
    templates: query.data ?? [],
    status: query.isPending ? "loading" : query.isError ? "error" : "ok",
    error: write.error ?? query.error?.message ?? null,
    busy: write.busy,
    create,
    update,
    remove,
    refresh,
    clearError,
  };
}

/** Mirrors the backend's `ORDER BY name, created_at` so a splice stays in place. */
function sortByName(templates: TaskTemplate[]): TaskTemplate[] {
  return [...templates].sort(
    (a, b) => a.name.localeCompare(b.name) || a.created_at.localeCompare(b.created_at),
  );
}
