// The sign-in screen's leg loop, as angles. An animation, not a gait: a legged
// robot's thighs swing and knees lift on a sine, the diagonal pairs half a
// cycle apart, around its own standing pose; a wheel-legged one holds that
// pose and rolls, its wheels turned by the ground it has covered.

/** One leg's joints and the pose it stands in. */
export interface StandLeg {
  /** Joint names, as the robot's joint table has them. */
  hipX: string;
  hipY: string;
  knee: string;
  /** The standing pose, radians. */
  stand: { hipX: number; hipY: number; knee: number };
}

export interface WalkLeg extends StandLeg {
  /** Where in the step this leg is when the loop starts, radians. */
  phase: number;
}

/** Steps along: the legs swing. */
export interface StepWalk {
  kind: "step";
  /** One full step, seconds. */
  stepS: number;
  /** How far the thigh swings either side of standing, radians. */
  swingHipY: number;
  /** How much further the knee folds at the top of its lift, radians. */
  liftKnee: number;
  legs: ReadonlyArray<WalkLeg>;
}

/**
 * Rolls along on its wheels: the legs hold the standing pose, which is how a
 * wheel-legged robot drives on flat ground, and only the wheels turn.
 */
export interface RollWalk {
  kind: "roll";
  legs: ReadonlyArray<StandLeg>;
  /** The wheel joints, each turned by the same angle. */
  wheels: ReadonlyArray<string>;
  /** The wheel's radius, metres: the ground one radian of turn covers. */
  wheelRadiusM: number;
}

export type WalkSpec = StepWalk | RollWalk;

/** How far into the loop the robot is: its time, and the ground covered. */
export interface WalkMotion {
  t: number;
  distanceM: number;
}

/**
 * Each joint's angle at `motion`; the standing pose (wheels at zero) when
 * `motion` is null.
 */
export function walkAngles(walk: WalkSpec, motion: WalkMotion | null): Record<string, number> {
  const angles: Record<string, number> = {};
  if (walk.kind === "roll") {
    for (const leg of walk.legs) {
      angles[leg.hipX] = leg.stand.hipX;
      angles[leg.hipY] = leg.stand.hipY;
      angles[leg.knee] = leg.stand.knee;
    }
    // Rolled by the distance, not by the time, so the wheels never slip
    // against the ground: the oval's speed is not constant. The wheel axis is
    // -y, and rolling forward along +x turns a wheel about +y: hence the minus.
    const q = motion === null ? 0 : -motion.distanceM / walk.wheelRadiusM;
    for (const wheel of walk.wheels) angles[wheel] = q;
    return angles;
  }
  for (const leg of walk.legs) {
    const p = motion === null ? 0 : (2 * Math.PI * motion.t) / walk.stepS + leg.phase;
    const lift = motion === null ? 0 : Math.max(0, Math.sin(p));
    const swing = motion === null ? 0 : Math.cos(p);
    angles[leg.hipX] = leg.stand.hipX;
    angles[leg.hipY] = leg.stand.hipY - walk.swingHipY * swing;
    // A knee lifts by folding further the way it already bends: a leg whose
    // knee points the other way lifts with the other sign.
    angles[leg.knee] = leg.stand.knee + Math.sign(leg.stand.knee) * walk.liftKnee * lift;
  }
  return angles;
}
