/**
 * Template-level rules the composer enforces before a request goes out. Kept
 * out of lib/api/task-template.ts so a name field need not import a fetcher.
 */

/** Mirrors the backend's `max_length=255` and the `String(255)` column. */
export const TASK_TEMPLATE_NAME_MAX = 255;

/**
 * Whether a typed name can be sent. The backend rejects a blank one as a 422
 * whose detail is a validation array rather than a sentence, so the editor
 * refuses it first.
 */
export function taskTemplateNameOk(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= TASK_TEMPLATE_NAME_MAX;
}
