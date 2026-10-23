import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useUndoHistory } from "@/hooks/use-undo-history";

/** Undo and Redo grey on these flags, so they must follow the stack exactly. */
describe("useUndoHistory", () => {
  it("lights Undo on an edit and Redo on an undo, and a new edit drops Redo", () => {
    const { result } = renderHook(() => useUndoHistory<string>(() => 1));
    expect(result.current).toMatchObject({ canUndo: false, canRedo: false });

    act(() => result.current.push("a"));
    expect(result.current).toMatchObject({ canUndo: true, canRedo: false });

    let popped: string | null = null;
    act(() => {
      popped = result.current.pop("undo");
    });
    expect(popped).toBe("a");
    expect(result.current).toMatchObject({ canUndo: false, canRedo: true });

    act(() => result.current.push("b"));
    expect(result.current).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("answers null and leaves the flags alone with nothing to take", () => {
    const { result } = renderHook(() => useUndoHistory<string>(() => 1));
    let popped: string | null = "x";
    act(() => {
      popped = result.current.pop("redo");
    });
    expect(popped).toBeNull();
    expect(result.current).toMatchObject({ canUndo: false, canRedo: false });
  });

  it("keeps one stack for the editor's life", () => {
    const { result, rerender } = renderHook(() => useUndoHistory<string>(() => 1));
    const first = result.current.stack;
    rerender();
    expect(result.current.stack).toBe(first);
  });
});
