import { describe, expect, it } from "vitest";

import {
  CONFIRM_NOT_CONVERGED,
  CONFIRM_NOT_NAVIGATING,
  INITIAL_POSE_JOB_RUNNING,
  START_LOCK_ERROR,
  START_LOCK_SILENT,
  START_LOCK_UNCONFIRMED,
  STATE_CHANGE_JOB_RUNNING,
  STATE_CHANGE_UNKNOWN,
  confirmLock,
  confirmOffered,
  confirmPanel,
  gateSupported,
  initialPoseLock,
  robotStatusView,
  startLock,
  stateAction,
  stateChangeLock,
  stateReading,
  stuckJobSuspected,
} from "@/lib/robot/readiness";

/**
 * The rules between the robot's state machine and an operator's press. Each
 * is a way the console could otherwise offer a job the robot will refuse,
 * hold one it would have taken, or let a state be changed under a running
 * job.
 */

describe("gateSupported", () => {
  it("takes the field's presence, not its value, as the backend having the gate", () => {
    expect(gateSupported({ localization_converged: false })).toBe(true);
    expect(gateSupported({ localization_converged: true })).toBe(true);
  });

  it("reads a frame without it as a backend from before the state machine", () => {
    expect(gateSupported({})).toBe(false);
  });
});

describe("stateReading", () => {
  const idle = { supported: true, state: "IDLE" };

  it("is the frame's word while the poll renews it", () => {
    expect(stateReading({ frame: idle, status: "ok" })).toEqual({ kind: "live", state: "IDLE" });
  });

  it("withholds the last frame's word once the poll fails: a memory is not a reading", () => {
    // The robot may have failed a job, or restarted unconfirmed, since.
    expect(stateReading({ frame: idle, status: "error" })).toEqual({ kind: "silent" });
    expect(
      stateReading({ frame: { supported: true, state: "ERROR" }, status: "error" }),
    ).toEqual({ kind: "silent" });
  });

  it("has nothing to draw before the first frame, however the poll stands", () => {
    // The strip's link chip says Linking or No signal there.
    for (const status of ["loading", "error", "ok"] as const) {
      expect(stateReading({ frame: undefined, status })).toEqual({ kind: "none" });
    }
  });

  it("has nothing to draw for a backend from before the state machine, failing or not", () => {
    const legacy = { supported: false, state: "UNINITIALIZED" };
    expect(stateReading({ frame: legacy, status: "ok" })).toEqual({ kind: "none" });
    expect(stateReading({ frame: legacy, status: "error" })).toEqual({ kind: "none" });
  });

  it("has nothing to draw for a frame with no state word", () => {
    expect(stateReading({ frame: { supported: true, state: null }, status: "ok" })).toEqual({
      kind: "none",
    });
  });
});

describe("robotStatusView", () => {
  it("has a word, a hue and a sentence for every state the robot reports", () => {
    for (const state of ["UNINITIALIZED", "IDLE", "RUNNING", "ERROR", "CHARGING", "WARNING"]) {
      const view = robotStatusView(state);
      expect(view.label, state).not.toBe(state);
      expect(view.detail, state).not.toBeNull();
    }
  });

  it("draws an error as a fault and an unconfirmed position as a caution", () => {
    expect(robotStatusView("ERROR").tone).toBe("warn");
    expect(robotStatusView("UNINITIALIZED").tone).toBe("caution");
    expect(robotStatusView("IDLE").tone).toBe("live");
  });

  it("shows a word it does not know as itself, in no hue", () => {
    // `state` is an open string: UNKNOWN today, a newer robot's state later.
    expect(robotStatusView("UNKNOWN")).toEqual({
      label: "UNKNOWN",
      tone: "neutral",
      loud: false,
      detail: null,
    });
    expect(robotStatusView("DOCKING").label).toBe("DOCKING");
  });
});

describe("startLock", () => {
  const on = { supported: true };

  it("holds every job while an error is latched, whatever the job does", () => {
    expect(startLock({ ...on, state: "ERROR", needsLocalization: false })).toEqual({
      locked: true,
      reason: START_LOCK_ERROR,
    });
    expect(startLock({ ...on, state: "ERROR", needsLocalization: true }).locked).toBe(true);
  });

  it("holds a job that drives on the map until the position is confirmed", () => {
    expect(startLock({ ...on, state: "UNINITIALIZED", needsLocalization: true })).toEqual({
      locked: true,
      reason: START_LOCK_UNCONFIRMED,
    });
  });

  it("lets a job that drives nowhere run on an unconfirmed robot", () => {
    // Standing up or speaking needs no position, and the robot takes it.
    expect(startLock({ ...on, state: "UNINITIALIZED", needsLocalization: false })).toEqual({
      locked: false,
      reason: null,
    });
  });

  it("holds nothing in any state that means the position is confirmed", () => {
    // The rollup: neither ERROR nor UNINITIALIZED is a confirmed position.
    for (const state of ["IDLE", "RUNNING", "CHARGING", "WARNING"]) {
      expect(startLock({ ...on, state, needsLocalization: true }).locked, state).toBe(false);
    }
  });

  it("fails open on a state it cannot read", () => {
    // The robot's own refusal still answers the press.
    for (const state of ["UNKNOWN", "DOCKING", null, undefined]) {
      expect(startLock({ ...on, state, needsLocalization: true }).locked).toBe(false);
    }
  });

  it("keeps the last frame's hold while the robot is silent, without repeating its word", () => {
    // The chip shows a dash then; "not confirmed" beside it would be the
    // reading the console declined to show.
    for (const state of ["ERROR", "UNINITIALIZED"]) {
      expect(startLock({ ...on, state, needsLocalization: true, silent: true })).toEqual({
        locked: true,
        reason: START_LOCK_SILENT,
      });
    }
  });

  it("lets a press the last frame allowed through while silent: the robot answers it", () => {
    expect(startLock({ ...on, state: "IDLE", needsLocalization: true, silent: true }).locked).toBe(
      false,
    );
    expect(
      startLock({ ...on, state: "UNINITIALIZED", needsLocalization: false, silent: true }).locked,
    ).toBe(false);
  });

  it("gates nothing on a backend from before the state machine", () => {
    // There UNINITIALIZED meant only "no pose yet" and refused nothing.
    expect(
      startLock({ supported: false, state: "UNINITIALIZED", needsLocalization: true }).locked,
    ).toBe(false);
    expect(startLock({ supported: false, state: "ERROR", needsLocalization: true }).locked).toBe(
      false,
    );
  });
});

describe("stateChangeLock", () => {
  it("is free over a readable, empty job list", () => {
    expect(stateChangeLock({ tasks: [], status: "ok" })).toEqual({ locked: false, reason: null });
  });

  it("locks under any job", () => {
    expect(stateChangeLock({ tasks: [{}], status: "ok" })).toEqual({
      locked: true,
      reason: STATE_CHANGE_JOB_RUNNING,
    });
  });

  it("treats a list it cannot read as unknown, not as empty", () => {
    // On an error the list is the last good one, and would miss a job since.
    expect(stateChangeLock({ tasks: [], status: "error" })).toEqual({
      locked: true,
      reason: STATE_CHANGE_UNKNOWN,
    });
    expect(stateChangeLock({ tasks: [], status: "loading" }).locked).toBe(true);
  });
});

describe("confirmLock", () => {
  const clear = { converged: true, mode: "AUTO" as const, tasks: [], status: "ok" as const };

  it("is free in Navigation mode, with nothing running, once the guess has settled", () => {
    expect(confirmLock(clear)).toEqual({ locked: false, reason: null });
  });

  it("locks until the robot has found its position on the map", () => {
    expect(confirmLock({ ...clear, converged: false })).toEqual({
      locked: true,
      reason: CONFIRM_NOT_CONVERGED,
    });
  });

  it("locks outside Navigation mode, where there is no map to be on", () => {
    expect(confirmLock({ ...clear, mode: "MANUAL" })).toEqual({
      locked: true,
      reason: CONFIRM_NOT_NAVIGATING,
    });
    expect(confirmLock({ ...clear, mode: "MAINTENANCE" }).locked).toBe(true);
  });

  it("leaves a mode it has not read yet to the backend's refusal", () => {
    expect(confirmLock({ ...clear, mode: null }).locked).toBe(false);
  });

  it("locks under a running job and under an unreadable list", () => {
    expect(confirmLock({ ...clear, tasks: [{}] }).reason).toBe(STATE_CHANGE_JOB_RUNNING);
    expect(confirmLock({ ...clear, status: "error" }).reason).toBe(STATE_CHANGE_UNKNOWN);
  });

  it("names the job before the guess: the job is the one to end first", () => {
    expect(confirmLock({ ...clear, converged: false, tasks: [{}] }).reason).toBe(
      STATE_CHANGE_JOB_RUNNING,
    );
  });
});

describe("stuckJobSuspected", () => {
  it("suspects a job the robot counts and the list does not have", () => {
    expect(stuckJobSuspected({ state: "RUNNING", tasks: [], status: "ok" })).toBe(true);
  });

  it("does not while the list has the job", () => {
    expect(stuckJobSuspected({ state: "RUNNING", tasks: [{}], status: "ok" })).toBe(false);
  });

  it("does not on a list it cannot read: unreadable is not empty", () => {
    expect(stuckJobSuspected({ state: "RUNNING", tasks: [], status: "error" })).toBe(false);
    expect(stuckJobSuspected({ state: "RUNNING", tasks: [], status: "loading" })).toBe(false);
  });

  it("does not in any other state", () => {
    for (const state of ["IDLE", "ERROR", "UNINITIALIZED", null, undefined]) {
      expect(stuckJobSuspected({ state, tasks: [], status: "ok" })).toBe(false);
    }
  });
});

describe("stateAction", () => {
  const clear = {
    converged: true,
    mode: "AUTO" as const,
    tasks: [],
    status: "ok" as const,
    stuck: false,
  };
  const one = (input: Parameters<typeof stateAction>[0]) => {
    const action = stateAction(input);
    return action && [action.id, action.target, action.lock];
  };

  it("offers to confirm an unconfirmed position", () => {
    expect(one({ ...clear, state: "UNINITIALIZED" })).toEqual(["confirm", "IDLE", null]);
  });

  it("greys Confirm with the reason until the guess has settled", () => {
    expect(one({ ...clear, state: "UNINITIALIZED", converged: false })).toEqual([
      "confirm",
      "IDLE",
      CONFIRM_NOT_CONVERGED,
    ]);
  });

  it("offers one way out of an error, and it confirms the position", () => {
    // No release that leaves the position unconfirmed: a robot that failed
    // a job is looked at before it takes another.
    expect(one({ ...clear, state: "ERROR" })).toEqual(["release-confirm", "IDLE", null]);
  });

  it("greys the release, with the reason, until the guess has settled", () => {
    // Set initial pose first: the release is owed a position to confirm.
    expect(one({ ...clear, state: "ERROR", converged: false })).toEqual([
      "release-confirm",
      "IDLE",
      CONFIRM_NOT_CONVERGED,
    ]);
  });

  it("never offers a target that leaves an error without a confirmed position", () => {
    for (const converged of [true, false]) {
      expect(stateAction({ ...clear, state: "ERROR", converged })?.target).toBe("IDLE");
    }
  });

  it("offers to withdraw the confirmation when idle", () => {
    expect(one({ ...clear, state: "IDLE" })).toEqual(["withdraw", "UNINITIALIZED", null]);
  });

  it("offers nothing while charging or on a low battery: those are said, not acted on", () => {
    for (const state of ["CHARGING", "WARNING"]) {
      expect(stateAction({ ...clear, state }), state).toBeNull();
    }
  });

  it("offers nothing while a job runs: the job has its own controls", () => {
    expect(stateAction({ ...clear, state: "RUNNING", tasks: [{}] })).toBeNull();
    expect(stateAction({ ...clear, state: "RUNNING" })).toBeNull();
  });

  it("offers to clear a stuck job, keeping the confirmation it ran under", () => {
    expect(one({ ...clear, state: "RUNNING", stuck: true })).toEqual(["clear-stuck", "IDLE", null]);
  });

  it("clears a stuck job to unconfirmed when there is no settled guess to keep", () => {
    // Asking for IDLE there is refused, and the job would stay stuck.
    expect(one({ ...clear, state: "RUNNING", stuck: true, converged: false })).toEqual([
      "clear-stuck",
      "UNINITIALIZED",
      null,
    ]);
  });

  it("offers nothing for a state it does not know", () => {
    expect(stateAction({ ...clear, state: "UNKNOWN" })).toBeNull();
  });

  it("greys every press under a running job", () => {
    const running = { ...clear, tasks: [{}] };
    for (const state of ["UNINITIALIZED", "ERROR", "IDLE"]) {
      expect(stateAction({ ...running, state })?.lock, state).toBe(STATE_CHANGE_JOB_RUNNING);
    }
  });
});

describe("robotStatusView's weight", () => {
  it("draws loud only the states the robot holds jobs for until someone acts", () => {
    expect(robotStatusView("UNINITIALIZED").loud).toBe(true);
    expect(robotStatusView("ERROR").loud).toBe(true);
    for (const state of ["IDLE", "RUNNING", "CHARGING", "WARNING", "UNKNOWN"]) {
      expect(robotStatusView(state).loud, state).toBe(false);
    }
  });
});

describe("confirmOffered", () => {
  const on = { supported: true, mode: "AUTO" as const };

  it("offers the dashboard's Confirm only while the position is unconfirmed", () => {
    expect(confirmOffered({ ...on, state: "UNINITIALIZED" })).toBe(true);
    for (const state of ["IDLE", "RUNNING", "ERROR", "CHARGING", null, undefined]) {
      expect(confirmOffered({ ...on, state })).toBe(false);
    }
  });

  it("does not in Mapping mode, where it could not be given", () => {
    expect(confirmOffered({ ...on, mode: "MANUAL", state: "UNINITIALIZED" })).toBe(false);
    expect(confirmOffered({ ...on, mode: null, state: "UNINITIALIZED" })).toBe(false);
  });

  it("does not on a backend from before the state machine", () => {
    expect(confirmOffered({ ...on, supported: false, state: "UNINITIALIZED" })).toBe(false);
  });
});

describe("confirmPanel", () => {
  const live = (state: string) => ({ kind: "live" as const, state });

  it("is up while the position is owed, in Navigation mode", () => {
    expect(confirmPanel({ reading: live("UNINITIALIZED"), lastState: "UNINITIALIZED", mode: "AUTO" })).toBe("live");
    expect(confirmPanel({ reading: live("IDLE"), lastState: "IDLE", mode: "AUTO" })).toBe("none");
    expect(confirmPanel({ reading: live("UNINITIALIZED"), lastState: "UNINITIALIZED", mode: "MANUAL" })).toBe("none");
  });

  it("stays up, held, when the robot goes silent while it is owed", () => {
    // Gone, it would take the button from under the operator's finger.
    expect(confirmPanel({ reading: { kind: "silent" }, lastState: "UNINITIALIZED", mode: "AUTO" })).toBe(
      "silent",
    );
  });

  it("does not appear for a silent robot that last reported anything else", () => {
    for (const lastState of ["IDLE", "ERROR", "RUNNING", null]) {
      expect(confirmPanel({ reading: { kind: "silent" }, lastState, mode: "AUTO" })).toBe("none");
    }
  });

  it("is never up without the state machine", () => {
    expect(confirmPanel({ reading: { kind: "none" }, lastState: "UNINITIALIZED", mode: "AUTO" })).toBe("none");
  });
});

describe("initialPoseLock", () => {
  it("is free with nothing running", () => {
    expect(initialPoseLock({ tasks: [], status: "ok" })).toEqual({ locked: false, reason: null });
  });

  it("locks under any job: a new pose moves the map frame under it", () => {
    expect(initialPoseLock({ tasks: [{}], status: "ok" })).toEqual({
      locked: true,
      reason: INITIAL_POSE_JOB_RUNNING,
    });
  });

  it("fails closed on a list it cannot read, as the backend does", () => {
    expect(initialPoseLock({ tasks: [], status: "error" })).toEqual({
      locked: true,
      reason: STATE_CHANGE_UNKNOWN,
    });
  });
});
