/**
 * The robot's id inside a sentence, in the readout face. The fallback "this
 * robot" stays in the body face; in mono it read as a stray readout.
 */
export function RobotName({ id }: { id: string | null | undefined }) {
  return id ? <span className="readout">{id}</span> : <>this robot</>;
}
