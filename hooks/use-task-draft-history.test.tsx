import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTaskDraftHistory } from "@/hooks/use-task-draft-history";
import { EMPTY_TASK_DRAFT, type TaskDraft } from "@/lib/task/draft-store";
import { newStepDraft } from "@/lib/task/step";

/** A draft held the way the tab's store holds it: one snapshot, changed by function. */
function harness(initial: TaskDraft = EMPTY_TASK_DRAFT) {
  let draft = initial;
  const update = (change: (current: TaskDraft) => TaskDraft) => {
    draft = change(draft);
  };
  const hook = renderHook(() => useTaskDraftHistory(update));
  return { hook, read: () => draft };
}

afterEach(() => vi.useRealTimers());

describe("useTaskDraftHistory", () => {
  it("takes back a removed stop and puts it back again", () => {
    const stop = newStepDraft("MOVE");
    const { hook, read } = harness({ ...EMPTY_TASK_DRAFT, steps: [stop] });
    act(() => hook.result.current.edit((draft) => ({ ...draft, steps: [] })));
    expect(hook.result.current.canUndo).toBe(true);

    act(() => hook.result.current.undo());
    expect(read().steps).toEqual([stop]);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(read().steps).toEqual([]);
  });

  // One Undo after typing a line takes the line, not its last letter.
  it("takes back a burst of typing in one step, and a pause starts another", () => {
    vi.useFakeTimers();
    const speak = newStepDraft("SPEAK");
    const { hook, read } = harness({ ...EMPTY_TASK_DRAFT, steps: [speak] });
    const type = (text: string) =>
      act(() =>
        hook.result.current.edit(
          (draft) => ({ ...draft, steps: [{ ...draft.steps[0]!, text }] }),
          `${speak.key}:text`,
        ),
      );
    type("h");
    type("hi");
    vi.advanceTimersByTime(5_000);
    type("hi there");

    act(() => hook.result.current.undo());
    expect(read().steps[0]!.text).toBe("hi");
    act(() => hook.result.current.undo());
    expect(read().steps[0]!.text).toBe("");
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("records nothing for a change Undo does not cover", () => {
    const { hook, read } = harness();
    act(() => hook.result.current.edit((draft) => ({ ...draft, name: "patrol" })));
    expect(read().name).toBe("patrol");
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("restores the map choice a switch made, with the waypoints it cleared", () => {
    const stop = { ...newStepDraft("MOVE"), vertexId: "v1" };
    const { hook, read } = harness({ ...EMPTY_TASK_DRAFT, chosenMap: "wh1", steps: [stop] });
    act(() =>
      hook.result.current.edit((draft) => ({
        ...draft,
        chosenMap: "wh2",
        steps: [{ ...stop, vertexId: null }],
      })),
    );
    act(() => hook.result.current.undo());
    expect(read()).toMatchObject({ chosenMap: "wh1", steps: [stop] });
  });
});
