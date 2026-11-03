"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchSettings,
  resetSettings,
  updateSettings,
  type NodeSettings,
  type SettingsPageId,
  type SettingValue,
} from "@/lib/api/settings";

/**
 * A settings page as the robot describes it: the list, their limits and
 * their values. Not polled (see the key's note).
 */
export function useSettings(page: SettingsPageId) {
  return useQuery({
    queryKey: queryKeys.settings(page),
    queryFn: ({ signal }) => fetchSettings(page, signal),
  });
}

/**
 * Change a page's settings, and reset them to the robot's defaults. Each
 * answers the whole new state, which replaces the cached one: a second read
 * would ask the robot again for what it has just said.
 */
export function useSettingsWrites(page: SettingsPageId) {
  const queryClient = useQueryClient();
  const store = (next: NodeSettings) => queryClient.setQueryData(queryKeys.settings(page), next);
  // A refusal changed nothing, but a failure past the robot's live set is
  // undone only as far as it could be: read again rather than trust the page.
  const reread = () => void queryClient.invalidateQueries({ queryKey: queryKeys.settings(page) });

  const update = useMutation({
    mutationFn: (values: Record<string, SettingValue>) => updateSettings(page, values),
    onSuccess: store,
    onError: reread,
  });
  const reset = useMutation({
    mutationFn: (ids?: string[]) => resetSettings(page, ids),
    onSuccess: store,
    onError: reread,
  });
  return { update, reset };
}
