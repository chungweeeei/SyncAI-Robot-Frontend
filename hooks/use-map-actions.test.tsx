import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { mapScopedKeys, queryKeys } from "@/lib/api/query-keys";

/**
 * The cache consequences of the map writes. A key missed here passes every
 * other gate — the write lands, the screen just shows the old answer until a
 * reload — so the list each write touches is held to here.
 */

let finishExport: () => void = () => {};

vi.mock("@/lib/api/map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/map")>()),
  renameMap: vi.fn(async () => ({})),
  deleteMap: vi.fn(async () => ({})),
  activateMap: vi.fn(async () => ({ previous: "old" })),
  // Half the archive arrives, then the rest when the test says so.
  exportMap: vi.fn(
    (_name: string, _format: string, onProgress?: (fraction: number) => void) =>
      new Promise<Blob>((resolve) => {
        onProgress?.(0.426);
        finishExport = () => {
          onProgress?.(1);
          resolve(new Blob());
        };
      }),
  ),
}));

vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

const { useActivateMap, useDeleteMap, useExportMap, useRenameMap } = await import(
  "@/hooks/use-map-actions"
);

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

describe("map writes", () => {
  it("a rename drops every cache of the old name and refreshes the templates bound to it", async () => {
    const { wrapper, removed, invalidated } = setup();
    const { result } = renderHook(() => useRenameMap(), { wrapper });
    await act(() => result.current.mutateAsync({ from: "lab", to: "lab-2" }));

    expect(removed).toEqual(expect.arrayContaining([...mapScopedKeys("lab")]));
    expect(removed).toHaveLength(mapScopedKeys("lab").length);
    expect(invalidated).toEqual(
      expect.arrayContaining([queryKeys.maps, queryKeys.taskTemplates]),
    );
  });

  it("a delete drops every cache of the map", async () => {
    const { wrapper, removed, invalidated } = setup();
    const { result } = renderHook(() => useDeleteMap(), { wrapper });
    await act(() => result.current.mutateAsync("lab"));

    expect(removed).toEqual(expect.arrayContaining([...mapScopedKeys("lab")]));
    expect(invalidated).toContainEqual(queryKeys.maps);
  });

  it("an activate refreshes both maps' waypoints and zones, since `active` moved between them", async () => {
    const { wrapper, invalidated } = setup();
    const { result } = renderHook(() => useActivateMap(), { wrapper });
    await act(() => result.current.mutateAsync("lab"));

    await waitFor(() =>
      expect(invalidated).toEqual(
        expect.arrayContaining([
          queryKeys.maps,
          queryKeys.taskTemplates,
          queryKeys.mapVertices("lab"),
          queryKeys.mapVertices("old"),
          queryKeys.mapKeepout("lab"),
          queryKeys.mapKeepout("old"),
        ]),
      ),
    );
  });
});

describe("map export", () => {
  it("reports the download in whole percent while it runs, and nothing once it ends", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useExportMap(), { wrapper });
    expect(result.current.progress).toBeNull();

    act(() => result.current.mutate({ name: "lab" }));
    await waitFor(() => expect(result.current.progress).toBe(42));

    act(() => finishExport());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.progress).toBeNull();
  });
});
