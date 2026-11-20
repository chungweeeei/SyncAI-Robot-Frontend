// Whether a decorative animation can afford to keep running on this machine.
// The sign-in robot redraws a 200k-triangle model every frame: nothing on a
// GPU, but on a machine drawing in software (a VM, remote desktop, hardware
// acceleration off) it held the main thread and the form typed late. Such a
// machine gets the still picture instead.

/** Below this many drawn frames a second the animation stops. */
export const MIN_FPS = 20;
/** How long the page settles first (the model's upload, the first frames), seconds. */
const WARMUP_S = 0.5;
/** How long the rate is measured over, seconds. */
const WINDOW_S = 1.5;
/**
 * A gap longer than this between two frames is the tab hidden or the machine
 * asleep, not a slow draw: the measurement starts over.
 */
const GAP_S = 0.5;

export type BudgetVerdict = "measuring" | "keep" | "stop";

export interface FrameBudget {
  /**
   * One animation-frame tick, `dt` seconds after the last, and whether a
   * frame was drawn on it. Answers "measuring" until the window is over,
   * then the verdict, once and for good.
   */
  tick: (dt: number, drew: boolean) => BudgetVerdict;
}

export function createFrameBudget(minFps = MIN_FPS): FrameBudget {
  let elapsed = 0;
  let drawn = 0;
  let verdict: BudgetVerdict = "measuring";
  return {
    tick: (dt, drew) => {
      if (verdict !== "measuring") return verdict;
      if (dt > GAP_S) {
        elapsed = 0;
        drawn = 0;
        return verdict;
      }
      elapsed += dt;
      if (elapsed <= WARMUP_S) return verdict;
      if (drew) drawn += 1;
      if (elapsed >= WARMUP_S + WINDOW_S) {
        verdict = drawn / WINDOW_S < minFps ? "stop" : "keep";
      }
      return verdict;
    },
  };
}
