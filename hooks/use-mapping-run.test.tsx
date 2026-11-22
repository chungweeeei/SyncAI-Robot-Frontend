import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { mapScopedKeys, queryKeys } from "@/lib/api/query-keys";

/**
 * The cache consequences of the run writes. The two that begin a run differ
 * from the one that ends it: a save replaces what is cached under its name, a
 * resume only reads the map it loads.
 */

vi.mock("@/lib/api/mapping", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/mapping")>()),
  resumeMapping: vi.fn(async ({ name }: { name: string }) => ({
    resumed: true,
    name,
    message: "Resumed the saved map.",
  })),
  saveMap: vi.fn(async (name: string) => ({ name, has_pointcloud: true, message: "Saved." })),
}));

const { resumeMapping } = await import("@/lib/api/mapping");
const { useResumeMapping, useSaveMap } = await import("@/hooks/use-mapping-run");

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const removed: unknown[] = [];
  const invalidated: unknown[] = [];
  vi.spyOn(client, "removeQueries").mockImplementation((filters) => {
    removed.push(filters?.queryKey);
  });
  vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    invalidated.push(filters?.queryKey);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, removed, invalidated };
}

describe("mapping run writes", () => {
  it("a resume re-reads the run state and leaves the map it loaded alone", async () => {
    const { wrapper, removed, invalidated } = setup();
    const { result } = renderHook(() => useResumeMapping(), { wrapper });
    await act(() => result.current.mutateAsync({ name: "lab" }));

    // The saved map is only read: its scan, 3D map, waypoints and zones are
    // what they were, and dropping them would re-download a map for nothing.
    expect(invalidated).toEqual([queryKeys.mappingStatus]);
    expect(removed).toEqual([]);
  });

  it("a resume sends no position, so the robot finds itself", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useResumeMapping(), { wrapper });
    await act(() => result.current.mutateAsync({ name: "lab" }));

    expect(resumeMapping).toHaveBeenLastCalledWith({ name: "lab" });
  });

  it("a save drops every cache of the name it wrote, and re-reads the catalogue and the run", async () => {
    const { wrapper, removed, invalidated } = setup();
    const { result } = renderHook(() => useSaveMap(), { wrapper });
    await act(() => result.current.mutateAsync({ name: "lab" }));

    expect(removed).toEqual(expect.arrayContaining([...mapScopedKeys("lab")]));
    expect(removed).toHaveLength(mapScopedKeys("lab").length);
    expect(invalidated).toEqual(
      expect.arrayContaining([queryKeys.maps, queryKeys.mappingStatus]),
    );
  });
});
