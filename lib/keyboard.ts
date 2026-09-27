/**
 * Input types that take focus but never take a letter. A range, a checkbox or
 * a button keeps focus after it is clicked, and asking "is it an INPUT?" made
 * the drive keys go dead the moment the operator had touched the Max speed
 * slider — nothing on screen said why, and the only way back was to click
 * somewhere blank. A slider answers to arrows, a checkbox to Space; neither
 * has any use for W.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether a keydown aimed at `target` is somebody typing, so a single-letter
 * shortcut has to leave it alone. SELECT counts: a focused select jumps to the
 * option starting with the letter pressed.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
