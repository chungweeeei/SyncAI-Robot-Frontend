/**
 * How a read stands, as every list and readout hook answers it. "error"
 * keeps whatever the hook last held: a failed poll is not an empty answer.
 */
export type ReadStatus = "loading" | "ok" | "error";
