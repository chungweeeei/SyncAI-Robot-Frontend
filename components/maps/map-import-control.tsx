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
import { importNameFromFilename, importSizeProblem } from "@/lib/map/archive";
import { MAP_NAME_RE } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

/**
 * Both gzip MIME spellings, since browsers disagree for a `.tar.gz`; the
 * extensions are what filter on most platforms.
 */
const ACCEPT =
  ".zip,.tar.gz,application/zip,application/gzip,application/x-gzip";

/**
 * The library-side face of POST /api/v1/maps/import: one button above the
 * grid, rendered before the empty state since a robot with no maps is where
 * it matters most. The picker is a hidden input the button clicks, still
 * named in the tree (which is how e2e hands it a file).
 *
 * A pick opens a confirm rather than uploading, because **an import under an
 * existing name silently replaces that map and its waypoints** (the backend
 * refuses only in-use or template-bound maps). The dialog shows
 * the landing name, pre-filled and editable, and turns destructive (Replace)
 * when it matches a card. Left empty, the archive's own name is used, which
 * this console can't read — hence the general warning.
 *
 * A refusal keeps the dialog open (409 `template_bound` names the templates).
 * A success's sentence goes up through `onResult` to MapLibrary's line, since
 * the card it is about doesn't exist yet.
 *
 * An archive past the robot's size limit is refused here, before a byte is
 * sent, in the backend's own 413 sentence: the dialog still opens (it is
 * where a refusal is read), with Import greyed. The backend's 413 is still
 * rendered if one comes back.
 *
 * While uploading, Cancel stays live ("Cancel upload") — a wrong file over a
 * weak link is minutes otherwise — and reports "Import canceled." on the same
 * line. Escape stays swallowed so a stray key can't drop the upload. Whether
 * the last byte landed is unknowable, so the hook refetches the catalogue.
 */
export function MapImportControl({
  maps,
  onResult,
}: {
  /** The catalogue, for the replace warning; null while it is still loading. */
  maps: readonly MapSummary[] | null;
  /** For the library's status line: the backend's sentence, or ours on cancel. */
  onResult?: (message: string) => void;
}) {
  const importing = useImportMap();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [archive, setArchive] = React.useState<File | null>(null);
  const [name, setName] = React.useState("");

  const busy = importing.isPending;
  const tooLarge = archive ? importSizeProblem(archive.size) : null;
  const error = tooLarge ?? importing.error?.message ?? null;

  const trimmed = name.trim();
  const valid = trimmed.length === 0 || MAP_NAME_RE.test(trimmed);
  const replaces =
    trimmed.length > 0 && (maps?.some((map) => map.name === trimmed) ?? false);

  const pick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Cleared at once: an input only fires `change` when the value differs,
    // so re-picking the same file after a Cancel would do nothing.
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
    // Detach from the mutation so the abort's rejection doesn't show as an
    // error on the next open.
    importing.reset();
  };

  const submit = () => {
    if (!archive || !valid || busy || tooLarge) return;
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
      {/* Solid signal-live: the page's one call to action, green because it
       * brings a map *in*. `text-background` keeps the label legible in both
       * themes. */}
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
          // Escape lands here; while uploading only the footer's button cancels.
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent>
          <form
            // A form so Enter confirms; the handler repeats the button's guard.
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
              {/* Shown only while the name breaks the rule, as on save and rename. */}
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
                disabled={!valid || busy || tooLarge !== null}
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
