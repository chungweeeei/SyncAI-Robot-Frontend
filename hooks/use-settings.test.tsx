import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-keys";
import type { NodeSettings } from "@/lib/api/settings";

/**
 * The cache consequences of a settings write: the answer is the whole new
 * state and replaces the cached one; a failure re-reads, because a failure
 * past the robot's live set was only undone as far as it could be.
 */

const after: NodeSettings = { live_available: true, groups: [], fields: [] };

vi.mock("@/lib/api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/settings")>()),
  updateSettings: vi.fn(async (_page: string, values: Record<string, unknown>) => {
    if ("refused" in values) throw new Error("The robot did not take the change.");
    return after;
  }),
  resetSettings: vi.fn(async () => after),
}));

const { useSettingsWrites } = await import("@/hooks/use-settings");

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

describe("settings writes", () => {
  it("a change writes the robot's answer into the cache", async () => {
    const { client, wrapper, invalidated } = setup();
    const { result } = renderHook(() => useSettingsWrites("planner"), { wrapper });

    await act(() => result.current.update.mutateAsync({ max_speed: 0.6 }));

    expect(client.getQueryData(queryKeys.settings("planner"))).toBe(after);
    expect(invalidated).toEqual([]);
  });

  it("a reset does too", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useSettingsWrites("planner"), { wrapper });

    await act(() => result.current.reset.mutateAsync(["max_speed"]));

    expect(client.getQueryData(queryKeys.settings("planner"))).toBe(after);
  });

  it("a failure re-reads instead of trusting the page", async () => {
    const { client, wrapper, invalidated } = setup();
    const { result } = renderHook(() => useSettingsWrites("planner"), { wrapper });

    await act(() =>
      result.current.update.mutateAsync({ refused: 1 }).catch(() => undefined),
    );

    expect(client.getQueryData(queryKeys.settings("planner"))).toBeUndefined();
    expect(invalidated).toEqual([queryKeys.settings("planner")]);
  });
});
