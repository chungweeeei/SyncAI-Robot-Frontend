import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { RobotStateContext } from "@/hooks/use-console-robot-state";
import type { UseRobotState } from "@/hooks/use-robot-state";
import { WifiBusyError } from "@/lib/api/network";

/**
 * The robot changes its Wi-Fi one request at a time (409 `wifi_busy`): every
 * join and forget greys while any of them is in flight from this console, and
 * a busy refusal — another console's change still running — reads as a wait.
 */

const BUSY = "The robot is already changing its WiFi connection; wait for that to finish.";

let releaseForget: () => void = () => {};

vi.mock("@/lib/api/network", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/network")>()),
  forgetWifiConnection: vi.fn(
    () => new Promise<void>((resolve) => (releaseForget = resolve)),
  ),
  activateWifiConnection: vi.fn(async () => {
    throw new WifiBusyError(BUSY);
  }),
}));

const { useWifiConnect } = await import("@/hooks/use-wifi-connect");
const { useForgetWifiConnection } = await import("@/hooks/use-wifi-connections");

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  const robot = { state: null, status: "loading" } as unknown as UseRobotState;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <RobotStateContext.Provider value={robot}>{children}</RobotStateContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper };
}

const saved = {
  uuid: "9a1e-lab",
  name: "Lab",
  ssid: "lab-5g",
  active: false,
  last_used_at: null,
};

describe("useWifiConnect", () => {
  it("is changing while a forget from another card is in flight, and not after", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => ({ wifi: useWifiConnect(), forget: useForgetWifiConnection() }),
      { wrapper },
    );
    expect(result.current.wifi.changing).toBe(false);

    act(() => result.current.forget.mutate("9a1e-lab"));
    await waitFor(() => expect(result.current.wifi.changing).toBe(true));
    // Its own join is not running: only the shared flag says to wait.
    expect(result.current.wifi.busy).toBe(false);

    act(() => releaseForget());
    await waitFor(() => expect(result.current.wifi.changing).toBe(false));
  });

  it("reads a busy refusal as a wait, keeping the backend's sentence", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWifiConnect(), { wrapper });

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.activate(saved);
    });

    expect(outcome).toBe("error");
    expect(result.current.error).toBe(BUSY);
    expect(result.current.errorBusy).toBe(true);
    // Refused before it was tried: nothing is heading anywhere.
    expect(result.current.pending).toBeNull();
  });
});
