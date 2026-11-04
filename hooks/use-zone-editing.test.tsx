import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ZonePolygon } from "@/lib/map/zone";

/**
 * The write half of the zones, with the keepout mutation stood in for: what
 * each press sends, and what the screen does with the answer.
 */

type Callbacks = {
  onSuccess: (result: unknown) => void;
  onError: (cause: Error) => void;
};
const mutate = vi.fn<(vars: { name: string; zones: ZonePolygon[] }, cb: Callbacks) => void>();

vi.mock("@/hooks/use-map-actions", () => ({
  useSaveMapKeepout: () => ({ mutate }),
}));

const { useZoneEditing } = await import("@/hooks/use-zone-editing");

const zone = (id: string): ZonePolygon => ({
  id,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ],
});

const ok = { name: "lab", zones: [], active: true, reloaded: true, message: "Saved" };

describe("useZoneEditing", () => {
  beforeEach(() => mutate.mockReset());

  it("stages a removal for Save, sending nothing until it is pressed", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => result.current.remove(["a"]));
    // Off the screen and unsaved, but the robot still holds it.
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["b"]);
    expect(result.current.dirty).toBe(true);
    expect(mutate).not.toHaveBeenCalled();

    act(() => result.current.save());
    expect(mutate.mock.calls[0][0].zones.map((entry) => entry.id)).toEqual(["b"]);
    act(() => mutate.mock.calls[0][1].onSuccess(ok));
    expect(result.current.dirty).toBe(false);
  });

  it("keeps a refused Save's removal staged, so the next Save sends it again", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => result.current.remove(["a"]));
    act(() => result.current.save());
    act(() => mutate.mock.calls[0][1].onError(new Error("A job is driving on this map.")));
    expect(result.current.note).toEqual({ kind: "failed", message: "A job is driving on this map." });
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["b"]);
    expect(result.current.dirty).toBe(true);
  });

  it("leaves the editor clean when the zone removed was never saved", () => {
    const { result } = renderHook(() => useZoneEditing("lab", []));
    act(() => {
      result.current.addCorner({ x: 0, y: 0 });
      result.current.addCorner({ x: 1, y: 0 });
      result.current.addCorner({ x: 1, y: 1 });
    });
    act(() => result.current.closeShape());
    const id = result.current.zones![0].id;
    act(() => result.current.remove([id]));
    expect(result.current.zones).toEqual([]);
    expect(result.current.dirty).toBe(false);
  });

  it("holds a second Save while one is in flight", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => result.current.remove(["a"]));
    act(() => result.current.save());
    act(() => result.current.remove(["b"]));
    act(() => result.current.save());
    // Each sends a whole list the other did not see; the later would undo the first.
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("hands each finished edit to onCommit once, a corner drag as one", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ cb }: { cb: typeof onCommit }) => useZoneEditing("lab", [zone("a"), zone("b")], { onCommit: cb }),
      { initialProps: { cb: onCommit } },
    );
    act(() => result.current.remove(["a"]));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].after.map((entry: ZonePolygon) => entry.id)).toEqual(["b"]);

    // A new callback is not a new edit.
    const next = vi.fn();
    rerender({ cb: next });
    expect(next).not.toHaveBeenCalled();

    for (const x of [-1, -2, -3]) {
      act(() => result.current.moveCorner({ zoneId: "b", index: 0 }, { x, y: 0 }));
    }
    expect(next).not.toHaveBeenCalled();
    act(() => result.current.endCornerDrag());
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].before).toEqual([zone("b")]);
  });

  it("puts a removed zone back on Undo, leaving nothing to save", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useZoneEditing("lab", [zone("a"), zone("b")], { onCommit }),
    );
    act(() => result.current.remove(["a"]));
    act(() => result.current.replace(onCommit.mock.calls[0][0].before));
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.current.dirty).toBe(false);
    // Undo is not itself an edit to record.
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("refuses to save over a list it has not read, then takes the first read", () => {
    const { result, rerender } = renderHook(
      ({ read }: { read: ZonePolygon[] | null }) => useZoneEditing("lab", read),
      { initialProps: { read: null as ZonePolygon[] | null } },
    );
    act(() => result.current.save());
    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.zones).toBeNull();

    rerender({ read: [zone("a")] });
    expect(result.current.zones).toEqual([zone("a")]);
    expect(result.current.dirty).toBe(false);
  });

  it("clears a finished save's note at the next edit, only when asked to", () => {
    const { result } = renderHook(() =>
      useZoneEditing("lab", [zone("a")], { clearNoteOnEdit: true }),
    );
    act(() => result.current.moveCorner({ zoneId: "a", index: 0 }, { x: -1, y: 0 }));
    act(() => result.current.save());
    act(() => mutate.mock.calls[0][1].onSuccess(ok));
    expect(result.current.note.kind).toBe("saved");

    act(() => result.current.moveCorner({ zoneId: "a", index: 0 }, { x: -2, y: 0 }));
    expect(result.current.note.kind).toBe("idle");
  });
});
