/**
 * The robot's id inside a sentence, for the page headers that name it.
 *
 * The id is set in the readout face, as it is everywhere else it appears; the
 * fallback before the first state frame is prose, and stays in the body face
 * — "this robot" in mono read as a stray readout in the middle of a sentence.
 */
export function RobotName({ id }: { id: string | null | undefined }) {
  return id ? <span className="readout">{id}</span> : <>this robot</>;
}
