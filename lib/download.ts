/**
 * Hand a file to the operator's own machine.
 *
 * No `showSaveFilePicker`, not even behind a secure-context check: the robot
 * serves this console over plain http, where that API does not exist, so the
 * branch would only ever run on a developer's localhost. A `blob:` URL is
 * same-origin, which is the only case `download` is honoured in.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";

  // On `document.body`, not anything the caller owns: Firefox ignores a click
  // on a detached anchor, and the caller may be unmounted (a clip saves after
  // its window has closed).
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // click() only starts the transfer, so revoking now can break it; never
  // revoking pins the file (up to ~0.5 GB for a clip) for the document's life.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
