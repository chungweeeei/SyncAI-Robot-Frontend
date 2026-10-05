"use client";

import * as React from "react";
import { ArrowLeftIcon, UploadIcon, XIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportMap } from "@/hooks/use-map-actions";
import { importNameFromFilename } from "@/lib/map/archive";
import { MAP_NAME_RE } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

/**
 * What the file picker offers by default. Both spellings of gzip, because
 * browsers disagree on which one a `.tar.gz` carries; the extensions are what
 * actually filter on most platforms.
 */
const ACCEPT =
  ".zip,.tar.gz,application/zip,application/gzip,application/x-gzip";

/**
 * The library-side face of POST /api/v1/maps/import.
 *
 * One button above the grid rather than anything on a card, because an import
 * is not about any map that is already here — and the screen it matters most
 * on is the one with no cards at all, which is why MapLibrary renders this
 * before its empty state rather than inside the grid.
 *
 * The picker is the browser's own, behind a hidden input the button clicks:
 * a visible file input cannot be styled into this console's vocabulary and
 * its own label ("No file chosen") is a state this control never shows. The
 * input is still in the tree with an accessible name, which is also how the
 * e2e suite hands it a file.
 *
 * Picking a file opens a confirm rather than uploading at once, for one
 * reason: **an import under a name that is already on the robot replaces
 * that map and its waypoints.** The backend refuses only when the map is in
 * use, mid-conversion or still targeted by a task template; an idle map with
 * hand-placed waypoints is silently overwritten. So the dialog shows the
 * name the map will land under, pre-filled from the file and editable, and
 * when it matches a card in the catalogue the confirm button turns
 * destructive and says Replace. Left empty, the name written inside the
 * archive is used — a name this console cannot read without unpacking the
 * file, which is why the empty case warns in general terms.
 *
 * A refusal keeps the dialog open and shows the backend's sentence there, as
 * the delete dialog does: 409 `template_bound` names the templates to go and
 * unbind, and closing the dialog would take the list away.
 *
 * On success the backend's sentence goes *up* through `onResult` to the
 * line MapLibrary keeps above the grid — the same line a rename's and a
 * delete's land on — because the thing the import produced is a new card,
 * and the sentence is about the catalogue rather than about this button.
 *
 * While the upload runs the footer's Cancel stays live and reads "Cancel
 * upload": a wrong file picked over a weak link is minutes of waiting
 * otherwise. It aborts the request and closes the dialog, and the one
 * sentence this console writes itself — "Import canceled." — goes up the same
 * line, so a dialog that vanished is explained. Escape is still swallowed
 * while busy: the button is the deliberate path, and an accidental key should
 * not throw an upload away. What the sentence cannot know is whether the last
 * byte had already landed; the hook refetches the catalogue for that case.
 */
export function MapImportControl({
  maps,
  onResult,
}: {
  /** The catalogue, for the replace warning; null while it is still loading. */
  maps: readonly MapSummary[] | null;
  /**
   * A sentence for the library's status line: the backend's on success, this
   * console's on cancel.
   */
  onResult?: (message: string) => void;
}) {
  const importing = useImportMap();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [archive, setArchive] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");

  const busy = importing.isPending;
  const error = importing.error?.message ?? null;

  const trimmed = name.trim();
  const valid = trimmed.length === 0 || MAP_NAME_RE.test(trimmed);
  const replaces =
    trimmed.length > 0 && (maps?.some((map) => map.name === trimmed) ?? false);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Cleared at once, so picking the same file again after a Cancel fires
    // `change` a second time — a file input only fires it when the value
    // differs from the last one.
    event.target.value = "";
    if (!file) return;
    importing.reset();
    setName(importNameFromFilename(file.name));
    setArchive(file);
  };

  const close = () => {
    if (busy) {
      importing.cancel();
      onResult?.("Import canceled.");
    }
    setArchive(null);
    // Detaches this dialog from the mutation, so the abort's rejection settles
    // in the background instead of rendering as an error on the next open.
    importing.reset();
  };

  const submit = () => {
    if (!archive || !valid || busy) return;
    importing.mutate(
      { archive, name: trimmed.length > 0 ? trimmed : undefined },
      {
        onSuccess: (result) => {
          onResult?.(result.message);
          setArchive(null);
        },
      },
    );
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        aria-label="Map archive"
        className="sr-only"
        tabIndex={-1}
        onChange={pick}
      />
      {/* Solid signal-live rather than a Button variant: the page's one
       * call to action, and green because it is the verb that brings a map
       * *in* — the console's hue for a value that is sound and present.
       * `text-background` keeps the label legible in both themes, where the
       * hue is dark on light and light on dark. */}
      <Button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="h-9 bg-signal-live px-4 text-sm text-background hover:bg-signal-live/85"
      >
        <UploadIcon data-icon="inline-start" className="size-4" />
        Import
      </Button>

      <AlertDialog
        open={archive !== null}
        onOpenChange={(open) => {
          // Escape is this path; while uploading only the footer's button may
          // cancel, so a stray key cannot throw the transfer away.
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent>
          <form
            // A form so Enter in the name field confirms, the way the rename
            // row does; the handler guards what the button's `disabled` does.
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            className="contents"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                Import <span className="readout">{archive?.name}</span>?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The map and its waypoints are copied onto this robot.{" "}
                {replaces ? (
                  <>
                    <span className="text-signal-warn">
                      A map named <span className="readout">{trimmed}</span> is
                      already here; importing replaces it and its waypoints.
                    </span>
                  </>
                ) : trimmed.length === 0 ? (
                  "It lands under the name saved inside the archive; a map already here under that name is replaced."
                ) : null}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="map-import-name" className="text-xs">
                Save as
              </Label>
              <Input
                id="map-import-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name saved inside the archive"
                aria-invalid={!valid ? true : undefined}
                disabled={busy}
                className="readout h-8 rounded-sm"
              />
              {/* The rule, shown only while the name breaks it — the same
               * line the save-map and rename rows use, because it is the
               * same rule. */}
              {!valid && (
                <p className="text-[11px] leading-snug text-signal-caution">
                  Letters, digits, dot, dash and underscore only, up to 64
                  characters.
                </p>
              )}
            </div>

            {error && (
              <p
                role="alert"
                className="text-[11px] leading-tight text-signal-warn"
              >
                {error}
              </p>
            )}

            <AlertDialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                {busy ? (
                  <>
                    <XIcon data-icon="inline-start" />
                    Cancel upload
                  </>
                ) : (
                  <>
                    <ArrowLeftIcon data-icon="inline-start" />
                    Cancel
                  </>
                )}
              </Button>
              <Button
                type="submit"
                variant={replaces ? "destructive" : "default"}
                size="sm"
                disabled={!valid || busy}
              >
                <UploadIcon data-icon="inline-start" />
                {busy ? "Importing…" : replaces ? "Replace" : "Import"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
