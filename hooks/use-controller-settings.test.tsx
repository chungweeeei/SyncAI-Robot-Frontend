import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-keys";
import type { ControllerSettings } from "@/lib/api/settings";

/**
 * The cache consequences of a settings write: the answer is the whole new
 * state and replaces the cached one; a failure re-reads, because a failure
 * past the robot's live set was only undone as far as it could be.
 */

const after: ControllerSettings = { live_available: true, groups: [], fields: [] };

vi.mock("@/lib/api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/settings")>()),
  updateControllerSettings: vi.fn(async (values: Record<string, unknown>) => {
    if ("refused" in values) throw new Error("The robot did not take the change.");
    return after;
  }),
  resetControllerSettings: vi.fn(async () => after),
}));

const { useControllerSettingsWrites } = await import("@/hooks/use-controller-settings");

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidated: unknown[] = [];
  vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    invalidated.push(filters?.queryKey);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper, invalidated };
}

describe("controller settings writes", () => {
  it("a change writes the robot's answer into the cache", async () => {
    const { client, wrapper, invalidated } = setup();
    const { result } = renderHook(() => useControllerSettingsWrites(), { wrapper });

    await act(() => result.current.update.mutateAsync({ max_speed: 0.6 }));

    expect(client.getQueryData(queryKeys.controllerSettings)).toBe(after);
    expect(invalidated).toEqual([]);
  });

  it("a reset does too", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useControllerSettingsWrites(), { wrapper });

    await act(() => result.current.reset.mutateAsync(["max_speed"]));

    expect(client.getQueryData(queryKeys.controllerSettings)).toBe(after);
  });

  it("a failure re-reads instead of trusting the page", async () => {
    const { client, wrapper, invalidated } = setup();
    const { result } = renderHook(() => useControllerSettingsWrites(), { wrapper });

    await act(() =>
      result.current.update.mutateAsync({ refused: 1 }).catch(() => undefined),
    );

    expect(client.getQueryData(queryKeys.controllerSettings)).toBeUndefined();
    expect(invalidated).toEqual([queryKeys.controllerSettings]);
  });
});
