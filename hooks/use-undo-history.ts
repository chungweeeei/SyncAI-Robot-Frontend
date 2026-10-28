"use client";

import * as React from "react";

import {
  createUndoStack,
  popRedo,
  popUndo,
  pushPatch,
  type UndoStack,
} from "@/lib/map/undo";

export interface UndoHistory<T> {
  /**
   * The stack itself, one object for the editor's life, for what rewrites
   * entries in place (a save's waypoint ids).
   */
  stack: UndoStack<T>;
  canUndo: boolean;
  canRedo: boolean;
  /** Record an edit; it clears what Redo had. */
  push: (entry: T) => void;
  /** Take the edit to undo or redo, or null when there is none. */
  pop: (direction: "undo" | "redo") => T | null;
}

/**
 * An editor's undo history (lib/map/undo.ts's byte-capped stack) with
 * the two flags its toolbar greys Undo and Redo on. Applying an entry stays
 * the editor's: only it knows what a stroke or a waypoint edit changes.
 */
export function useUndoHistory<T>(size: (entry: T) => number): UndoHistory<T> {
  // Lazily, so a render does not build a stack only to throw it away.
  const [stack] = React.useState(() => createUndoStack<T>(size));
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  const push = React.useCallback(
    (entry: T) => {
      pushPatch(stack, entry);
      setCanUndo(true);
      setCanRedo(false);
    },
    [stack],
  );

  const pop = React.useCallback(
    (direction: "undo" | "redo") => {
      const entry = direction === "undo" ? popUndo(stack) : popRedo(stack);
      if (entry === null) return null;
      setCanUndo(stack.undo.length > 0);
      setCanRedo(stack.redo.length > 0);
      return entry;
    },
    [stack],
  );

  return { stack, canUndo, canRedo, push, pop };
}
