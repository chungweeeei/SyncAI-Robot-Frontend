"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ErrorLine } from "@/components/console/error-line";
import { Input } from "@/components/ui/input";
import { useMapRenameDraft } from "@/hooks/use-map-rename-draft";
import { MAP_NAME_HINT } from "@/lib/map/name";

const DIRTY_REASON =
  "Save your changes first. Renaming a map reloads it, which would throw away anything you have not saved.";

/**
 * The editor's title, and the header-side face of PATCH /api/v1/maps/{name}.
 *
 * Double-click (or Enter / F2) turns the name into an input; Enter saves,
 * Escape cancels. No Rename button: a once-per-map press doesn't earn
 * permanent space in a two-line header over the canvas. The /maps card keeps
 * its button, where a double-click on a grid of names is undiscoverable.
 *
 * Shares MapRenameControl's rules, but shows the backend's refusals
 * (`map_active`, `name_taken`) rather than pre-greying — it has no
 * MapSummary to grey from. Its own refusal is `dirty`: a rename navigates to
 * the new route, which reloads the editor and would throw unsaved edits away.
 *
 */
export function MapTitleRename({ name, dirty }: { name: string; dirty: boolean }) {
  const router = useRouter();
  // The draft and the write are useMapRenameDraft's, shared with the card.
  const rename = useMapRenameDraft(name);
  const { editing, draft, setDraft, trimmed, valid, changed, busy } = rename;

  /** The `dirty` refusal — not a request outcome, so not on the mutation. */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /**
   * Held locally rather than read off the mutation: the success handler
   * navigates, and a blur-cancel racing it resets the mutation.
   */
  const [note, setNote] = React.useState<string | null>(null);

  const error = refusal ?? rename.error;

  const begin = () => {
    if (dirty) {
      // Refused before the input opens: nothing typed could make it allowed.
      setRefusal(DIRTY_REASON);
      return;
    }
    setRefusal(null);
    setNote(null);
    rename.begin();
  };

  const cancel = () => {
    setRefusal(null);
    rename.cancel();
  };

  const submit = () => {
    if (busy) return;
    // Enter on an unchanged name just closes.
    if (!changed) {
      cancel();
      return;
    }
    rename.submit((result, to) => {
      setNote(result.message);
      // replace, not push: the old URL names a directory that no longer
      // exists. The query (tool, back target) rides along.
      router.replace(`/maps/${encodeURIComponent(to)}/edit${window.location.search}`);
    });
  };

  if (editing) {
    return (
      <div className="min-w-0">
        <p className="instrument-label text-muted-foreground">Rename map</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              // Stopped here, or the editor's window-level Escape (above its
              // typing guard on purpose) would also disarm the tools.
              event.stopPropagation();
              cancel();
            }}
            // Blur cancels rather than saves: the click that takes focus is
            // almost always a map gesture, not a decision to rename.
            onBlur={cancel}
            aria-label="New map name"
            aria-invalid={trimmed.length > 0 && !valid ? true : undefined}
            disabled={busy}
            className="readout h-7 w-56 rounded-sm px-1.5 font-medium text-[15px]"
          />
        </form>

        {/* Shown only while the name breaks the rule, as on the card and save. */}
        {trimmed.length > 0 && !valid && (
          <p className="mt-0.5 text-[11px] leading-snug text-signal-caution">
            {MAP_NAME_HINT}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* No eyebrow over the name, by request. Focusable, with Enter or F2
        * (the file-manager key) opening it, so the rename isn't mouse-only. */}
      <h1
        tabIndex={0}
        onDoubleClick={begin}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "F2") return;
          event.preventDefault();
          begin();
        }}
        title={dirty ? DIRTY_REASON : "Double-click to rename"}
        aria-label={`${name} — double-click or press F2 to rename`}
        className="readout -mx-1 truncate rounded-sm px-1 text-[15px] font-medium transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-cmd"
      >
        {name}
      </h1>
      {error && (
        <ErrorLine className="mt-0.5">
          {error}
        </ErrorLine>
      )}
      {/* The renamed title is the lasting receipt; this sentence (what was
        * re-keyed with it) is read once, and lost if the route remounts. */}
      {note && !error && (
        <p role="status" className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
