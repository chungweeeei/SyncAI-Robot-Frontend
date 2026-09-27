/**
 * The EFIS colour semantic every readout is drawn in: pick it by what the
 * value *is* (measured / commanded / degraded / faulted), not by how it looks.
 * The classes that render each tone are components/console/instrument.tsx's.
 *
 * In lib/types/ because the rules in lib/robot/levels.ts answer in it, and a
 * type that lib/ needs cannot live in components/.
 */
export type Tone = "neutral" | "live" | "cmd" | "active" | "caution" | "warn";
