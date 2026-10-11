import { describe, expect, it } from "vitest";

import {
  AUTO_LOCALIZE_JOB_RUNNING,
  AUTO_LOCALIZE_NOT_NAVIGATING,
  AUTO_LOCALIZE_UNKNOWN,
  DISPATCH_LOCK_CONVERTING,
  RUN_LOCK_RUNNING,
  RUN_LOCK_UNKNOWN,
  autoLocalizeLock,
  dispatchMapLock,
  mapRunLock,
} from "@/lib/map/run-lock";

/**
 * The rules that keep a map still under a running job. Each one is a way the
 * console could otherwise let an edit land under a moving robot, or lock a
 * map nobody is using.
 */

describe("mapRunLock", () => {
  it("locks a map a running job names", () => {
    expect(
      mapRunLock({ mapName: "lab", tasks: [{ map_name: "lab" }], status: "ok" }),
    ).toEqual({ locked: true, reason: RUN_LOCK_RUNNING });
  });

  it("does not lock a map because of a job on another one", () => {
    expect(
      mapRunLock({ mapName: "lab", tasks: [{ map_name: "warehouse" }], status: "ok" }),
    ).toEqual({ locked: false, reason: null });
  });

  it("does not lock any map for a job that uses none (Stand, Lie down)", () => {
    expect(
      mapRunLock({ mapName: "lab", tasks: [{ map_name: null }], status: "ok" }).locked,
    ).toBe(false);
  });

  it("leaves a map editable when nothing is running", () => {
    expect(mapRunLock({ mapName: "lab", tasks: [], status: "ok" }).locked).toBe(false);
  });

  it("treats a failed read as unknown, not as idle", () => {
    // The last good list says nothing is running; it is a memory, and a job
    // that started since would not be in it.
    expect(mapRunLock({ mapName: "lab", tasks: [], status: "error" })).toEqual({
      locked: true,
      reason: RUN_LOCK_UNKNOWN,
    });
  });

  it("locks before the first answer arrives", () => {
    expect(mapRunLock({ mapName: "lab", tasks: [], status: "loading" }).locked).toBe(true);
  });

  it("never locks when there is no map to lock", () => {
    expect(mapRunLock({ mapName: null, tasks: [], status: "error" }).locked).toBe(false);
  });
});

describe("dispatchMapLock", () => {
  it("holds a moving job while its map's floor plan is being rebuilt", () => {
    expect(dispatchMapLock({ grid_status: "converting" })).toEqual({
      locked: true,
      reason: DISPATCH_LOCK_CONVERTING,
    });
  });

  it("lets a job go once the floor plan is ready, or failed and kept its old one", () => {
    expect(dispatchMapLock({ grid_status: "ok" }).locked).toBe(false);
    expect(dispatchMapLock({ grid_status: "failed" }).locked).toBe(false);
  });

  it("does not hold a job when the map is not known", () => {
    expect(dispatchMapLock(null).locked).toBe(false);
  });
});

describe("autoLocalizeLock", () => {
  it("is free in Navigation mode with nothing running", () => {
    expect(autoLocalizeLock({ mode: "AUTO", tasks: [], status: "ok" })).toEqual({
      locked: false,
      reason: null,
    });
  });

  it("locks under any job, whatever map it is on", () => {
    expect(
      autoLocalizeLock({ mode: "AUTO", tasks: [{ map_name: null }], status: "ok" }),
    ).toEqual({ locked: true, reason: AUTO_LOCALIZE_JOB_RUNNING });
  });

  it("locks in Mapping mode, where nothing would answer", () => {
    expect(autoLocalizeLock({ mode: "MANUAL", tasks: [], status: "ok" })).toEqual({
      locked: true,
      reason: AUTO_LOCALIZE_NOT_NAVIGATING,
    });
  });

  it("treats an unread job list as unknown, not as idle", () => {
    expect(autoLocalizeLock({ mode: "AUTO", tasks: [], status: "error" })).toEqual({
      locked: true,
      reason: AUTO_LOCALIZE_UNKNOWN,
    });
  });

  it("leaves a mode not yet reported to the backend", () => {
    expect(autoLocalizeLock({ mode: null, tasks: [], status: "ok" }).locked).toBe(false);
  });
});
