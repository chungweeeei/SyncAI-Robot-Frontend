"use client";

import * as React from "react";

import { isTypingTarget } from "@/lib/keyboard";
import {
  AT_REST_VECTOR,
  commandFrom,
  isStickKey,
  resolveStick,
  type StickId,
  type StickValue,
} from "@/lib/teleop/stick";
import type { TeleopVector } from "@/lib/types/robot";

export interface JoystickState {
  /**
   * Knob positions: clamped but PRE-deadzone — the deadzone belongs to the
   * command, not the hand. Left is the unit circle, right the x axis.
   */
  left: StickValue;
  right: StickValue;
  /** Pointer captured or keys deflecting that stick. */
  leftActive: boolean;
  rightActive: boolean;
  /** POST-deadzone commanded vector, rAF-coalesced — what the readouts show. */
  vector: TeleopVector;
  /**
   * Always-current `vector`, written synchronously on every input event (rAF
   * stops in a hidden tab, and a stale command must not survive). The sender's
   * 10 Hz loop reads it without re-rendering anything.
   */
  vectorRef: React.RefObject<TeleopVector>;
  /** Called by each Thumbstick with its raw deflection; null on release. */
  setPointer: (stick: StickId, value: StickValue | null) => void;
}

interface Snapshot {
  left: StickValue;
  right: StickValue;
  leftActive: boolean;
  rightActive: boolean;
  vector: TeleopVector;
}

const AT_REST: Snapshot = {
  left: { x: 0, y: 0 },
  right: { x: 0, y: 0 },
  leftActive: false,
  rightActive: false,
  vector: AT_REST_VECTOR,
};

/**
 * Dual-thumbstick teleop state: left = translation, right = rotation, pointer
 * and keyboard merged into one vector. **Everything here is COMMANDED, nothing
 * measured** (cf. use-locomotion.ts), hence the cmd hue. The maths is
 * lib/teleop/stick.ts.
 *
 * Inputs live in refs and one rAF-coalesced publish makes at most one setState
 * per frame; call it inside the small panel so pointer-rate renders never
 * reach the viewport.
 *
 * While `enabled` (the arm switch) is false the hook is deaf — no window key
 * listeners, setPointer a no-op — because an always-live WASD hook turns
 * stray keystrokes into motion. Disarming zeroes whatever input was live.
 */
export function useJoystick(enabled: boolean, linearScale = 1): JoystickState {
  const pointerRef = React.useRef<Record<StickId, StickValue | null>>({
    left: null,
    right: null,
  });
  const keysRef = React.useRef<Set<string>>(new Set());
  const rafRef = React.useRef<number | null>(null);
  const snapRef = React.useRef<Snapshot>(AT_REST);
  const vectorRef = React.useRef<TeleopVector>(AT_REST.vector);
  // A ref so a new limit does not rebuild publish and every listener with it.
  const linearScaleRef = React.useRef(linearScale);
  const [snapshot, setSnapshot] = React.useState<Snapshot>(AT_REST);

  const publish = React.useCallback(() => {
    const left = resolveStick("left", pointerRef.current.left, keysRef.current);
    const right = resolveStick("right", pointerRef.current.right, keysRef.current);
    snapRef.current = {
      left: left.value,
      right: right.value,
      leftActive: left.active,
      rightActive: right.active,
      vector: commandFrom(left.value, right.value, linearScaleRef.current),
    };
    // Synchronous, ahead of the rAF: see the vectorRef doc above.
    vectorRef.current = snapRef.current.vector;

    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setSnapshot(snapRef.current);
    });
  }, []);

  // Publish so a key already held takes the new limit at once; vectorRef only
  // changes when publish runs.
  React.useEffect(() => {
    linearScaleRef.current = linearScale;
    publish();
  }, [linearScale, publish]);

  const setPointer = React.useCallback(
    (stick: StickId, value: StickValue | null) => {
      // Deaf even to a pointer captured before the disarm, which keeps
      // delivering moves.
      if (!enabled) return;
      pointerRef.current[stick] = value;
      publish();
    },
    [enabled, publish],
  );

  React.useEffect(() => {
    if (!enabled) {
      // Drop held keys and a mid-drag deflection to rest, readouts and
      // vectorRef alike.
      if (
        keysRef.current.size > 0 ||
        pointerRef.current.left ||
        pointerRef.current.right
      ) {
        keysRef.current.clear();
        pointerRef.current.left = null;
        pointerRef.current.right = null;
        publish();
      }
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // Chords stay the browser's (Ctrl+W). Only keydown checks: a keyup must
      // always release, or W-down / Ctrl-down / W-up leaves the robot commanded.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isStickKey(event.code) || event.repeat) return;
      keysRef.current.add(event.code);
      publish();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!keysRef.current.delete(event.code)) return;
      publish();
    };

    // A key held across an alt-tab must not leave a standing deflection.
    const onBlur = () => {
      if (keysRef.current.size === 0) return;
      keysRef.current.clear();
      publish();
    };

    // On window: the sticks are never focused.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, publish]);

  // Clear the ref with the frame: StrictMode remounts after cleanup, and a
  // stale id reads to publish() as "a frame is coming", freezing the readouts
  // while the sender kept driving.
  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  return { ...snapshot, vectorRef, setPointer };
}
