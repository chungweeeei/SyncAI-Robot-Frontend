"use client";

import * as React from "react";

import {
  EMPTY_TASK_DRAFT,
  createTaskDraftStore,
  type TaskDraft,
  type TaskDraftStore,
} from "@/lib/task/draft-store";

/**
 * One store per tab. The `sessionStorage` accessor itself can throw (blocked
 * site data), which must read as "no storage", not a crashed page.
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
 * The task editor's unsaved work, as a subscription: the first client render
 * must match the server's empty one, and useSyncExternalStore swaps the draft
 * in without a mismatch or a setState in an effect. See lib/task/draft-store.ts.
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
