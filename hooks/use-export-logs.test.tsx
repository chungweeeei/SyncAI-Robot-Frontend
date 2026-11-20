import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportLogs } from "@/lib/api/logs";
import { downloadBlob } from "@/lib/download";
import { useExportLogs } from "@/hooks/use-export-logs";

let finish: () => void = () => {};

vi.mock("@/lib/api/logs", () => ({
  // The robot builds the bundle (no progress), then a third arrives, then the
  // rest when the test says so.
  exportLogs: vi.fn(
    (onProgress?: (fraction: number) => void) =>
      new Promise<Blob>((resolve) => {
        finish = () => {
          onProgress?.(1);
          resolve(new Blob([new Uint8Array(2048)]));
        };
        setTimeout(() => onProgress?.(0.333), 0);
      }),
  ),
}));
vi.mock("@/lib/download", () => ({ downloadBlob: vi.fn() }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useExportLogs", () => {
  beforeEach(() => {
    vi.mocked(downloadBlob).mockClear();
  });

  it("counts the wait, then the transfer, then saves the bundle under the robot's name", async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 20, 3, 4, 5));
    const { result } = renderHook(() => useExportLogs("robot01"), { wrapper });

    act(() => result.current.mutate());
    // Before the first byte there is no total: a start time, no percent.
    await waitFor(() => expect(result.current.startedAt).not.toBeNull());
    await waitFor(() => expect(result.current.progress).toBe(33));

    act(() => finish());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      filename: "robot01-logs-20261120T030405Z.tar",
      bytes: 2048,
    });
    expect(downloadBlob).toHaveBeenCalledOnce();
    expect(vi.mocked(downloadBlob).mock.calls[0]![1]).toBe("robot01-logs-20261120T030405Z.tar");
    // Done: nothing left counting.
    expect(result.current.progress).toBeNull();
    expect(result.current.startedAt).toBeNull();
    vi.useRealTimers();
  });

  it("saves nothing and keeps the robot's sentence when it refuses", async () => {
    vi.mocked(exportLogs).mockRejectedValueOnce(new Error("The robot could not build the log bundle."));
    const { result } = renderHook(() => useExportLogs("robot01"), { wrapper });

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("The robot could not build the log bundle.");
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
