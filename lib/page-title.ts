/**
 * A tab's title: the screen first, so a narrowed tab keeps the part that
 * tells two tabs apart. Written whole by every segment rather than through
 * the root's `title.template`, because a nested layout that sets its own
 * title stops the template reaching the pages under it.
 */
export function pageTitle(screen: string): string {
  return `${screen} · SyncAI Robot Console`;
}
