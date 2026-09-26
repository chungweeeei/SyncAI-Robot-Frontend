"use client";

import * as React from "react";

import {
  EMPTY_TASK_DRAFT,
  createTaskDraftStore,
  type TaskDraft,
  type TaskDraftStore,
} from "@/lib/task/draft-store";

/**
 * One store per tab, created on first use. `sessionStorage` is read behind a
 * guard: on the server there is no window, and in a browser the accessor
 * itself can throw (blocked site data), which must read as "no storage", not
 * as a crashed page.
 */
let store: TaskDraftStore | null = null;

function taskDraftStore(): TaskDraftStore {
  if (store) return store;
  let storage: Storage | null = null;
  if (typeof window !== "undefined") {
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
  }
  store = createTaskDraftStore(storage);
  return store;
}

const serverSnapshot = () => EMPTY_TASK_DRAFT;

/**
 * The task editor's unsaved work, as a subscription rather than as state.
 *
 * The draft is browser-side and the page is server-rendered, so the first
 * client render has to agree with the server's empty one; useSyncExternalStore
 * is what then swaps the tab's draft in without a hydration mismatch and
 * without a setState in an effect. Read lib/task/draft-store.ts for what is
 * kept and for how long.
 */
export function useTaskDraft(): [
  draft: TaskDraft,
  update: (change: (draft: TaskDraft) => TaskDraft) => void,
  clear: () => void,
] {
  const current = taskDraftStore();
  const draft = React.useSyncExternalStore(
    current.subscribe,
    current.getSnapshot,
    serverSnapshot,
  );
  return [draft, current.update, current.clear];
}
