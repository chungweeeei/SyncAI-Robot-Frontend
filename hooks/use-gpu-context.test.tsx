import { act, render, renderHook, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GpuContextLostError, useGpuContext } from "@/hooks/use-gpu-context";

class Catch extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p>caught {this.state.error.name}</p> : this.props.children;
  }
}

describe("useGpuContext", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads lost between a loss and its restore", () => {
    const { result } = renderHook(() => useGpuContext(1000));
    expect(result.current.lost).toBe(false);

    act(() => result.current.onContextLost());
    expect(result.current.lost).toBe(true);

    act(() => result.current.onContextRestored());
    expect(result.current.lost).toBe(false);
  });

  it("does not give up on a context that came back in time", () => {
    const { result } = renderHook(() => useGpuContext(1000));
    act(() => result.current.onContextLost());
    act(() => result.current.onContextRestored());
    // The loss's timer must not fire after the restore and fail the view.
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current.lost).toBe(false);
  });

  it("throws to the view's boundary when the context never returns", () => {
    // React logs the error it hands the boundary; that is the point here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let gpu: ReturnType<typeof useGpuContext> | null = null;
    function View() {
      gpu = useGpuContext(1000);
      return <p>view</p>;
    }
    render(
      <Catch>
        <View />
      </Catch>,
    );

    act(() => gpu!.onContextLost());
    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByText("view")).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(`caught ${new GpuContextLostError().name}`)).toBeTruthy();
    quiet.mockRestore();
  });
});
