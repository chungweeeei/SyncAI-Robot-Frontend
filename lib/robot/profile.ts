import { G23_JOINTS } from "@/lib/robot/g23-joints";
import type { JointSpec } from "@/lib/robot/joint";
import { M20_JOINTS } from "@/lib/robot/m20-joints";
import type { WalkSpec } from "@/lib/robot/walk";

// Everything the console draws differently from one kind of robot to another,
// in one place: which model, how its joints turn, how tall it stands, where
// its motors sit in the motor grid, and how its legs loop on the sign-in
// screen. The robot says which kind it is (`robot_model` on its state, and on
// /health before sign-in); nothing here is chosen at build time, so one image
// serves every robot.

export type RobotModelId = "g23" | "m20";

/** One leg's cell of the motor grid: its name, and its motors top to bottom. */
export interface MotorGridLeg {
  label: string;
  motors: ReadonlyArray<{
    /** The row's words (Hip roll, Knee). */
    label: string;
    /** The motor's name on the wire. */
    name: string;
  }>;
}

export interface RobotProfile {
  id: RobotModelId;
  /** The GLB baked from the robot's URDF (scripts/urdf2glb.py). */
  modelUrl: string;
  /**
   * base_link's height over the ground at the GLB's rest pose, metres. The
   * pose feed carries base_link's real height, so the model is drawn at it as
   * is; this is for standing the robot on a ground height instead (an initial
   * pose placed on a floor) and for finding the ground under a reported pose.
   */
  baseHeightM: number;
  /** joint name -> how to drive it on the GLB. */
  joints: ReadonlyMap<string, JointSpec>;
  /**
   * The motor grid in plan view, two to a row: front left, front right, hind
   * left, hind right.
   */
  motorGrid: ReadonlyArray<MotorGridLeg>;
  /** How it moves round the sign-in screen's route: steps, or rolls. */
  walk: WalkSpec;
}

const LEG_LABELS = ["Front left", "Front right", "Hind left", "Hind right"] as const;

/**
 * Proximal to distal. Words, not the codes (HX / HY / KN) they replaced: a
 * code needs a key, and the screen is shown to people who do not have one.
 * Hip roll turns the leg out from the body, hip pitch swings it fore and aft.
 */
const HIP_ROLL = "Hip roll";
const HIP_PITCH = "Hip pitch";
const KNEE = "Knee";
const WHEEL = "Wheel";

const G23_LEGS = ["FL", "FR", "HL", "HR"] as const;

/**
 * The G23. Its rest pose stands 0.43212 m: the link offsets to the foot plus
 * the 22 mm foot sphere.
 */
const G23: RobotProfile = {
  id: "g23",
  modelUrl: "/models/g23.glb",
  baseHeightM: 0.43212,
  joints: G23_JOINTS,
  motorGrid: G23_LEGS.map((leg, index) => ({
    label: LEG_LABELS[index],
    motors: [
      { label: HIP_ROLL, name: `${leg}_HipX_joint` },
      { label: HIP_PITCH, name: `${leg}_HipY_joint` },
      { label: KNEE, name: `${leg}_Knee_joint` },
    ],
  })),
  walk: {
    kind: "step",
    stepS: 0.9,
    swingHipY: 0.22,
    liftKnee: 0.45,
    // Diagonal pairs (FL + HR, FR + HL) half a cycle apart.
    legs: G23_LEGS.map((leg) => ({
      hipX: `${leg}_HipX_joint`,
      hipY: `${leg}_HipY_joint`,
      knee: `${leg}_Knee_joint`,
      stand: { hipX: 0, hipY: -0.75, knee: 1.5 },
      phase: leg === "FL" || leg === "HR" ? 0 : Math.PI,
    })),
  },
};

const M20_LEGS = ["fl", "fr", "hl", "hr"] as const;

/**
 * The Lynx M20, wheel-legged. Its rest pose has the legs straight down: the
 * wheel's axle 0.50 m under base_link, and the wheel's 0.09 m radius under
 * that (measured off its meshes).
 *
 * The standing pose is the one the robot reported standing (2026-11-24):
 * its front knees fold forward and its hind knees back, so the hind pair's
 * angles mirror the front's. The hips are rolled a little outward.
 */
const M20: RobotProfile = {
  id: "m20",
  modelUrl: "/models/m20.glb",
  baseHeightM: 0.59,
  joints: M20_JOINTS,
  motorGrid: M20_LEGS.map((leg, index) => ({
    label: LEG_LABELS[index],
    motors: [
      { label: HIP_ROLL, name: `${leg}_hipx_joint` },
      { label: HIP_PITCH, name: `${leg}_hipy_joint` },
      { label: KNEE, name: `${leg}_knee_joint` },
      { label: WHEEL, name: `${leg}_wheel_joint` },
    ],
  })),
  // It drives on its wheels with its legs held, so on the sign-in screen it
  // rolls round the route rather than stepping.
  walk: {
    kind: "roll",
    wheelRadiusM: 0.09,
    wheels: M20_LEGS.map((leg) => `${leg}_wheel_joint`),
    legs: M20_LEGS.map((leg) => {
      const front = leg[0] === "f";
      const left = leg[1] === "l";
      return {
        hipX: `${leg}_hipx_joint`,
        hipY: `${leg}_hipy_joint`,
        knee: `${leg}_knee_joint`,
        stand: {
          hipX: left ? 0.07 : -0.07,
          hipY: front ? -0.234 : 0.274,
          knee: front ? 0.462 : -0.563,
        },
      };
    }),
  },
};

const PROFILES: ReadonlyMap<string, RobotProfile> = new Map([
  ["g23", G23],
  ["m20", M20],
]);

/** The profile to fall back on where the robot cannot be asked: the G23's. */
export const G23_PROFILE = G23;

/**
 * The profile for the model a robot reports, or null for one this console
 * does not know: no robot is drawn then and its motors are listed unplaced,
 * since a guessed model is the wrong machine drawn with nothing to say so.
 *
 * `undefined` is a backend from before it reported a model, which is not the
 * same thing: every robot it ran on was a G23.
 */
export function robotProfile(model: string | undefined): RobotProfile | null {
  if (model === undefined) return G23;
  return PROFILES.get(model.trim().toLowerCase()) ?? null;
}
