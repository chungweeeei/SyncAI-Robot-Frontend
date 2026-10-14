"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRenameMap } from "@/hooks/use-map-actions";
import { MAP_NAME_RE } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

const LOCKED_REASON =
  "The robot is working in this map right now, so it cannot be renamed. Switch it to another map first.";
const CONVERTING_REASON =
  "This map is still being prepared. Wait for it to finish.";

/**
 * The card's title, and the card-side face of PATCH /api/v1/maps/{name}: press
 * Rename and the title becomes an inline input with Save and Cancel (no menu,
 * no modal — name edits here are inline forms). Enter saves, Escape cancels.
 *
 * **The map in use can't be renamed — the backend's rule** (409 `map_active`):
 * the running stack opened its files by path at launch. Switching to another
 * map frees the name, but a rename isn't entitled to do that swap itself.
 * Greyed on the active card and mid-conversion (the conversion holds the old
 * path), with the reason in the tooltip.
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
  const rename = useRenameMap();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(map.name);

  const busy = rename.isPending;
  // 409 (taken, converting, in use) and 400 arrive as the backend's sentence.
  const error = rename.error?.message ?? null;

  const trimmed = name.trim();
  const valid = MAP_NAME_RE.test(trimmed);
  const changed = trimmed !== map.name;
  const locked = map.active;

  const begin = () => {
    setName(map.name);
    rename.reset();
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    rename.reset();
  };

  const submit = () => {
    if (!valid || !changed || busy) return;
    rename.mutate(
      { from: map.name, to: trimmed },
      {
        onSuccess: (result) => {
          onRenamed?.(result.message);
          setEditing(false);
        },
      },
    );
  };

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
            className="readout h-7 min-w-0 flex-1 rounded-sm px-1.5 font-medium md:text-[15px]"
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
            Letters, digits, dot, dash and underscore only, up to 64 characters.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-[11px] leading-snug text-signal-warn">
            {error}
          </p>
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
      {locked || map.grid_status === "converting" ? (
        <span
          aria-disabled="true"
          title={locked ? LOCKED_REASON : CONVERTING_REASON}
          className="instrument-label flex h-5 shrink-0 cursor-not-allowed items-center rounded-sm px-1 text-muted-foreground opacity-40"
        >
          Rename
        </span>
      ) : (
        <button
          type="button"
          onClick={begin}
          aria-label={`Rename ${map.name}`}
          className="instrument-label flex h-5 shrink-0 items-center rounded-sm px-1 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          Rename
        </button>
      )}
    </>
  );
}
