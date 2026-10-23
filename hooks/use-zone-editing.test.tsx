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

  it("removes from the last saved list, so unsaved zones do not ride along", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => {
      result.current.addCorner({ x: 5, y: 5 });
      result.current.addCorner({ x: 6, y: 5 });
      result.current.addCorner({ x: 6, y: 6 });
    });
    act(() => result.current.closeShape());
    expect(result.current.zones).toHaveLength(3);
    const drawn = result.current.zones![2].id;

    act(() => result.current.remove(["a"]));
    const [vars] = mutate.mock.calls[0];
    expect(vars.zones.map((entry) => entry.id)).toEqual(["b"]);
    // The new zone is still on screen, waiting for Save.
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["b", drawn]);
    expect(result.current.dirty).toBe(true);
  });

  it("puts a zone back when the robot refuses to delete it", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => result.current.remove(["a"]));
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["b"]);
    expect(result.current.writing).toBe(true);

    act(() => mutate.mock.calls[0][1].onError(new Error("A job is driving on this map.")));
    expect(result.current.zones?.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(result.current.note).toEqual({ kind: "failed", message: "A job is driving on this map." });
    expect(result.current.dirty).toBe(false);
  });

  it("sends nothing for a zone that was never saved", () => {
    const { result } = renderHook(() => useZoneEditing("lab", []));
    act(() => {
      result.current.addCorner({ x: 0, y: 0 });
      result.current.addCorner({ x: 1, y: 0 });
      result.current.addCorner({ x: 1, y: 1 });
    });
    act(() => result.current.closeShape());
    const id = result.current.zones![0].id;
    act(() => result.current.remove([id]));
    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.zones).toEqual([]);
  });

  it("holds a second write while one is in flight", () => {
    const { result } = renderHook(() => useZoneEditing("lab", [zone("a"), zone("b")]));
    act(() => result.current.remove(["a"]));
    act(() => result.current.remove(["b"]));
    // Each sends a whole list the other did not see; the later would undo the first.
    expect(mutate).toHaveBeenCalledTimes(1);
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
