"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchControllerSettings,
  resetControllerSettings,
  updateControllerSettings,
  type ControllerSettings,
  type SettingValue,
} from "@/lib/api/settings";

/**
 * The controller's settings as the robot describes them: the list, their
 * limits and their values. Not polled (see the key's note).
 */
export function useControllerSettings() {
  return useQuery({
    queryKey: queryKeys.controllerSettings,
    queryFn: ({ signal }) => fetchControllerSettings(signal),
  });
}

/**
 * Change settings, and reset them to the robot's defaults. Each answers the
 * whole new state, which replaces the cached one: a second read would ask the
 * robot again for what it has just said.
 */
export function useControllerSettingsWrites() {
  const queryClient = useQueryClient();
  const store = (next: ControllerSettings) =>
    queryClient.setQueryData(queryKeys.controllerSettings, next);
  // A refusal changed nothing, but a failure past the robot's live set is
  // undone only as far as it could be: read again rather than trust the page.
  const reread = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.controllerSettings });

  const update = useMutation({
    mutationFn: (values: Record<string, SettingValue>) => updateControllerSettings(values),
    onSuccess: store,
    onError: reread,
  });
  const reset = useMutation({
    mutationFn: (ids?: string[]) => resetControllerSettings(ids),
    onSuccess: store,
    onError: reread,
  });
  return { update, reset };
}
