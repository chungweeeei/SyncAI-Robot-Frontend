"use client";

import { ErrorLine } from "@/components/console/error-line";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapRenameDraft } from "@/hooks/use-map-rename-draft";
import { MAP_NAME_HINT } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

const LOCKED_REASON =
  "The robot is working in this map right now, so it cannot be renamed. Switch it to another map first.";
/**
 * The card's title, and the card-side face of PATCH /api/v1/maps/{name}: press
 * Rename and the title becomes an inline input with Save and Cancel (no menu,
 * no modal — name edits here are inline forms). Enter saves, Escape cancels.
 *
 * **The map in use can't be renamed — the backend's rule** (409 `map_active`):
 * the running stack opened its files by path at launch. Switching to another
 * map frees the name, but a rename isn't entitled to do that swap itself.
 * Greyed on the active card, with the reason in the tooltip.
 *
 * On success the card remounts under the new name, so the sentence goes up
 * through `onRenamed` to MapLibrary's line. Cache keys are useRenameMap's.
 */
export function MapRenameControl({
  map,
  onRenamed,
}: {
  map: MapSummary;
  /** The backend's sentence, for a surface that outlives this card. */
  onRenamed?: (message: string) => void;
}) {
  // The draft and the write are useMapRenameDraft's, shared with the
  // editor's title; 409 (taken, in use) and 400 arrive as the backend's sentence.
  const draft = useMapRenameDraft(map.name);
  const { editing, draft: name, setDraft: setName, trimmed, valid, changed } = draft;
  const { busy, error, begin, cancel } = draft;
  const locked = map.active;

  const submit = () => draft.submit((result) => onRenamed?.(result.message));

  if (editing) {
    return (
      <div className="min-w-0 flex-1">
        <form
          // A form so Enter saves.
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex items-center gap-1.5"
        >
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            aria-label="New map name"
            aria-invalid={trimmed.length > 0 && !valid ? true : undefined}
            disabled={busy}
            className="readout h-7 min-w-0 flex-1 rounded-sm px-1.5 font-medium text-[15px]"
          />
          <Button
            type="submit"
            size="xs"
            disabled={!valid || !changed || busy}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={cancel}
          >
            Cancel
          </Button>
        </form>

        {/* Shown only while the name breaks the rule, as on save. */}
        {trimmed.length > 0 && !valid && (
          <p className="mt-1 text-[11px] leading-snug text-signal-caution">
            {MAP_NAME_HINT}
          </p>
        )}
        {error && (
          <ErrorLine className="mt-1">
            {error}
          </ErrorLine>
        )}
      </div>
    );
  }

  return (
    <>
      <h2 className="readout min-w-0 flex-1 truncate text-[15px] font-medium">
        {map.name}
      </h2>
      {/* A look-alike span when blocked: `disabled` swallows the pointer
        * events the tooltip needs. */}
      {locked ? (
        <span
          aria-disabled="true"
          title={LOCKED_REASON}
          className="instrument-label flex h-5 shrink-0 cursor-not-allowed items-center rounded-sm px-1 text-muted-foreground opacity-40 pointer-coarse:h-10 pointer-coarse:px-2"
        >
          Rename
        </span>
      ) : (
        <button
          type="button"
          onClick={begin}
          aria-label={`Rename ${map.name}`}
          className="instrument-label flex h-5 shrink-0 items-center rounded-sm px-1 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:h-10 pointer-coarse:px-2"
        >
          Rename
        </button>
      )}
    </>
  );
}
