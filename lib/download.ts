/**
 * Hand a file to the operator's own machine.
 *
 * The console's first save-to-disk path, and its own module at lib/ root rather
 * than a corner of lib/video/: what a Blob contains is the caller's business,
 * and the mechanism for getting one out of the browser is the same whether it
 * is a clip, a floor plan or a log.
 *
 * `showSaveFilePicker` is deliberately not used, not even behind a secure-
 * context check. The robot serves this console over plain http on a LAN, so the
 * File System Access API does not exist on the one machine that matters, and a
 * branch that only ever runs on a developer's localhost is a path the robot
 * never tests. Object URLs and the `download` attribute have no such
 * requirement — `blob:` is same-origin, which is the only case `download` is
 * honoured in anyway.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  // Appended to the document, and to `document.body` rather than to anything
  // the caller owns: Firefox will not act on a click to a detached anchor, and
  // the caller may already be unmounted — a clip saves itself after the window
  // that started it has closed, which is the whole point of this path.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // click() only *starts* the transfer. Revoking in the same task can leave the
  // browser fetching a URL that no longer resolves; never revoking pins the
  // whole file — up to half a gigabyte for a clip — for the life of the
  // document. A second is free next to either failure.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
