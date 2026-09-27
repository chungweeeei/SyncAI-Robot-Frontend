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
   * Knob display positions: clamped, but PRE-deadzone. The knob follows the
   * finger; the deadzone belongs to the command, not to the hand. Left stick is
   * clamped to the unit circle, right stick to the x axis (its y is always 0).
   */
  left: StickValue;
  right: StickValue;
  /** Pointer captured OR keys deflecting that stick — drives the cmd styling. */
  leftActive: boolean;
  rightActive: boolean;
  /** POST-deadzone commanded vector, rAF-coalesced — what the readouts show. */
  vector: TeleopVector;
  /**
   * Always-current mirror of `vector`, updated synchronously on every input
   * event (not just per animation frame — rAF stops in a hidden tab, and a
   * stale non-zero command surviving an alt-tab is exactly the bug the blur
   * handler below exists to prevent). This ref is the contract for the cmd_vel
   * sender (use-teleop-sender.ts / teleop-channel.ts): the send loop has its
   * own clock (a 10 Hz interval), so it reads this without ever re-rendering
   * anything. A callback prop at pointer rate was rejected — it would push
   * send-rate policy onto every consumer.
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
 * Dual-thumbstick teleop state: left stick = planar translation, right stick =
 * rotation, pointer and keyboard merged into one commanded vector.
 *
 * **Everything in here is COMMANDED, nothing is measured** — cf. the epistemics
 * note in use-locomotion.ts. That is why the panel renders all of it in the cmd
 * hue: these numbers are what the operator is asking for; the robot's answer
 * arrives separately, through telemetry, in the live hue. This hook is the
 * visual half — the sender (use-teleop-sender.ts) reads `vectorRef` and never
 * touches anything else here.
 *
 * The maths — clamp, deadzone, key bindings, pointer-over-keys merging and the
 * screen-to-body-frame turn — is lib/teleop/stick.ts, where it is tested. What
 * is left here is when it runs and who hears about it.
 *
 * Rendering follows grid-canvas's rule: raw inputs live in refs, and one
 * rAF-coalesced publish turns them into at most one setState per frame. The
 * hook is meant to be called inside the small overlay panel, so pointer-rate
 * updates re-render a few hundred pixels of DOM and never the viewport.
 *
 * `enabled` is the arm switch, and while it is false the hook is deaf: no
 * keyboard listeners are attached and setPointer is a no-op. Deaf here rather
 * than hidden in the panel, because the dangerous half is the keyboard — a
 * window-level WASD hook that is always live turns typing-adjacent muscle
 * memory anywhere on the dashboard into stick deflection, which is merely
 * confusing today and becomes motion the day a sender lands. Disarming also
 * zeroes whatever input was live at that moment: an armed command must not
 * survive the operator saying stop listening.
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
  // Read by publish(), which runs from input events and the effect below; a
  // ref so a new limit does not rebuild publish and every listener with it.
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

  // A new limit applies to whatever is already held, at once. Without the
  // publish, a key held down across the change would keep its old speed until
  // the next input event, and the 10 Hz sender would go on sending it:
  // vectorRef only changes when publish runs.
  React.useEffect(() => {
    linearScaleRef.current = linearScale;
    publish();
  }, [linearScale, publish]);

  const setPointer = React.useCallback(
    (stick: StickId, value: StickValue | null) => {
      // Disarmed = deaf, even to a pointer already captured: a touch that was
      // dragging a stick when the arm toggle was hit keeps delivering moves
      // (its capture is on the Thumbstick's element), and they must land here
      // as nothing.
      if (!enabled) return;
      pointerRef.current[stick] = value;
      publish();
    },
    [enabled, publish],
  );

  React.useEffect(() => {
    if (!enabled) {
      // Zero out whatever was live at the moment of disarm — held keys, a
      // mid-drag deflection — so the readouts (and vectorRef, which a sender
      // will trust) drop to rest instead of freezing at the last command.
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
      // Chords stay the browser's: Ctrl+W must close the tab, not drive
      // forward. Only keydown checks this — a keyup must always release its
      // key, or W-down / Ctrl-down / W-up would leave the robot commanded.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!isStickKey(event.code) || event.repeat) return;
      keysRef.current.add(event.code);
      publish();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!keysRef.current.delete(event.code)) return;
      publish();
    };

    // A key held across an alt-tab must not leave a standing deflection —
    // same reasoning as map-grid-editor's spacePan reset on blur.
    const onBlur = () => {
      if (keysRef.current.size === 0) return;
      keysRef.current.clear();
      publish();
    };

    // On window, not the panel: the sticks are never focused, and driving
    // should work the moment the dashboard is on screen.
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, publish]);

  // The ref is cleared with the frame it named. A cleanup is not always an
  // unmount — StrictMode runs it and then mounts again — and a stale id left
  // here reads to publish() as "a frame is already coming", so the readouts
  // froze at rest for good while the sender, which reads vectorRef, kept
  // driving.
  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  return { ...snapshot, vectorRef, setPointer };
}
