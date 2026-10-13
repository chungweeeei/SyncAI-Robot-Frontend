/**
 * Input types that take focus but never a letter. A slider or checkbox keeps
 * focus after a click, so treating every INPUT as typing left the drive keys
 * dead after touching Max speed, with nothing on screen saying why.
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
 * Whether a keydown on `target` is typing, so a letter shortcut must leave it
 * alone. SELECT counts: it jumps to the option starting with the letter.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
