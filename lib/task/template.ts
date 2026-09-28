/**
 * Template-level rules the composer enforces before a request goes out.
 *
 * Separate from lib/task/step.ts, which is about what one *step* is, and from
 * lib/api/task-template.ts, which is the REST client: a name field that needs
 * nothing but a length limit should not have to import a fetcher module to get
 * it, which is the layering break CLAUDE.md names. The steps' own conversion
 * to dispatch shape lives in step.ts beside its siblings.
 */

/** Mirrors the backend's `max_length=255` and the `String(255)` column. */
export const TASK_TEMPLATE_NAME_MAX = 255;

/**
 * Whether a typed name can be sent. The backend strips and rejects a blank
 * one, but as a 422 whose detail is a validation *array* rather than a
 * sentence, so the editor refuses it first — the same reason the vertex panel
 * checks its own name. Shared by the name field (for its hint) and the
 * editor's Save button (for its gate), which sit in different parts of the
 * page.
 */
export function taskTemplateNameOk(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= TASK_TEMPLATE_NAME_MAX;
}
