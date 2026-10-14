/**
 * The colour semantic every readout is drawn in: pick it by what the value
 * *is* (measured / commanded / degraded / faulted), not by how it looks.
 * Rendered by components/console/instrument.tsx.
 */
export type Tone = "neutral" | "live" | "cmd" | "active" | "caution" | "warn";
