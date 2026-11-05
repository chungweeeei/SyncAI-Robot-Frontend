import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { GoalPose, RoutePreview } from "@/lib/api/task";

/**
 * A preview is a question, not a write: it touches no cached resource, and of
 * two aims in a row only the second one's answer may be shown.
 */

const pending: { goal: GoalPose; resolve: (preview: RoutePreview) => void }[] = [];

vi.mock("@/lib/api/task", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/task")>()),
  previewRoute: vi.fn(
    (goal: GoalPose) =>
      new Promise<RoutePreview>((resolve) => pending.push({ goal, resolve })),
  ),
}));

const { previewRoute } = await import("@/lib/api/task");
const { useRoutePreview } = await import("@/hooks/use-route-preview");

function route(length: number): RoutePreview {
  return { reachable: true, points: [[0, 0, 0], [length, 0, 0]], length_m: length, code: null, message: "" };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const setData = vi.spyOn(client, "setQueryData");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate, setData };
}

describe("useRoutePreview", () => {
  it("shows the answer for the goal it was asked about, on the map it was aimed on", async () => {
    pending.length = 0;
    const { wrapper } = setup();
    const { result } = renderHook(() => useRoutePreview("lab"), { wrapper });

    act(() => result.current.request({ x: 2, y: 1, theta: -180 }));
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(result.current.pending).toBe(true);
    // The heading folded as a MOVE's is: the backend refuses -180.
    expect(result.current.goal).toEqual({ x: 2, y: 1, theta: 180 });
    expect(previewRoute).toHaveBeenLastCalledWith({ x: 2, y: 1, theta: 180 }, "lab");

    act(() => pending[0].resolve(route(4)));
    await waitFor(() => expect(result.current.preview?.length_m).toBe(4));
    expect(result.current.pending).toBe(false);
  });

  it("never lets a slow answer for an earlier aim land over a later one", async () => {
    pending.length = 0;
    const { wrapper } = setup();
    const { result } = renderHook(() => useRoutePreview("lab"), { wrapper });

    act(() => result.current.request({ x: 1, y: 0, theta: 0 }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.request({ x: 9, y: 0, theta: 0 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    act(() => pending[1].resolve(route(9)));
    await waitFor(() => expect(result.current.preview?.length_m).toBe(9));

    await act(async () => pending[0].resolve(route(1)));
    expect(result.current.preview?.length_m).toBe(9);
    expect(result.current.goal?.x).toBe(9);
  });

  it("changes nothing cached, and Discard leaves nothing behind", async () => {
    pending.length = 0;
    const { wrapper, invalidate, setData } = setup();
    const { result } = renderHook(() => useRoutePreview("lab"), { wrapper });

    act(() => result.current.request({ x: 3, y: 0, theta: 0 }));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => pending[0].resolve(route(3)));
    await waitFor(() => expect(result.current.preview).not.toBeNull());
    act(() => result.current.clear());

    await waitFor(() => expect(result.current.goal).toBeNull());
    expect(result.current.preview).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
    expect(setData).not.toHaveBeenCalled();
  });
});
