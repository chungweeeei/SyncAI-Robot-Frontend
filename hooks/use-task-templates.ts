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
  StepRefusalError,
  type TaskTemplate,
  type TaskTemplateChanges,
  type TaskTemplateDraft,
} from "@/lib/api/task-template";

export type TaskTemplatesStatus = "loading" | "ok" | "error";

export interface UseTaskTemplates {
  /** Every template on the robot, by name; scoping is the caller's. */
  templates: TaskTemplate[];
  status: TaskTemplatesStatus;
  /** The load failure or the latest write failure, rendered verbatim. */
  error: string | null;
  /**
   * The wire id of the step the last refused write named (`3-move`), or null.
   * Beside `error`, never instead of it: the sentence still says why.
   */
  refusedStepId: string | null;
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
 * The library of re-dispatchable templates. POST and PUT answer with the
 * stored row, so the list is spliced rather than refetched (unlike
 * useSchedules).
 *
 * MOVE steps resolve against a vertex's *current* pose server-side, so vertex
 * writes mark this key stale; `refresh` is the escape hatch for a long-open
 * tab. Write failures live on the mutations so a reload cannot clear them.
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
      // In the server's order, so the row does not jump on the next refresh.
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

  // Rejections are swallowed: every caller is an onClick, which reads `error`
  // and the return value, and a rethrow would be an unhandled rejection.
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
    refusedStepId: write.failure instanceof StepRefusalError ? write.failure.stepId : null,
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
