"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { useSaveMapFloors } from "@/hooks/use-map-actions";
import { useMapFloors } from "@/hooks/use-map-floors";
import { FLOOR_NAME_MAX, floorsProblem, nextFloor, sameFloors } from "@/lib/map/floors";
import { cn } from "@/lib/utils";
import type { MapFloor } from "@/lib/types/map";

/** A row as typed: the height stays text so "-" and "5." survive the keystroke. */
interface DraftRow {
  id: number;
  name: string;
  level: string;
}

/**
 * The floors of a map that spans storeys, named and set by hand: rename a
 * detected floor (`1F` to `B1`), drop a landing taken for a floor, add one
 * the walk was too short to find. Folded by default, since most maps are
 * one storey and a detected pair is usually right.
 *
 * A draft over the read rather than a copy of it: untouched, it shows the
 * list the backend answers with, so a save from another console arrives;
 * once edited, it holds until Save or Revert.
 */
export function FloorListEditor({ name, className }: { name: string; className?: string }) {
  const { floors, detected, saved, ready, error: readError } = useMapFloors(name);
  const { mutate: save, isPending, error: saveError, reset } = useSaveMapFloors();
  const [draft, setDraft] = React.useState<DraftRow[] | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const nextId = React.useRef(0);

  const toRows = React.useCallback(
    (list: readonly MapFloor[]): DraftRow[] =>
      list.map((floor) => ({ id: nextId.current++, name: floor.name, level: String(floor.level) })),
    [],
  );
  // Untouched, the rows are the read's and keyed by place; a draft's get
  // fresh ids from the handler that starts it, so a removed row's inputs do
  // not slide onto its neighbour.
  const rows: DraftRow[] =
    draft ??
    floors.map((floor, i) => ({ id: -1 - i, name: floor.name, level: String(floor.level) }));
  const parsed: MapFloor[] = rows.map((row) => ({
    name: row.name,
    level: row.level.trim() === "" ? Number.NaN : Number(row.level),
  }));
  const dirty = draft !== null && !sameFloors(parsed, floors);
  const problem = dirty ? floorsProblem(parsed) : null;

  const edit = (next: DraftRow[]) => {
    setDraft(next);
    setMessage(null);
    reset();
  };
  const update = (id: number, patch: Partial<DraftRow>) =>
    edit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const onSave = () => {
    if (!dirty || problem || isPending) return;
    save(
      { name, floors: parsed },
      {
        onSuccess: (result) => {
          setDraft(null);
          setMessage(result.message);
        },
      },
    );
  };

  const useDetected = !sameFloors(detected, draft ? parsed : floors);

  return (
    <details className={cn(overlayPanel, "pointer-events-auto p-2.5", className)}>
      <summary className="instrument-label cursor-pointer text-muted-foreground">
        Floors{ready ? ` · ${floors.length > 1 ? floors.length : "one storey"}` : ""}
      </summary>
      <div className="mt-2 space-y-2 text-[11px] leading-snug">
        {readError && <p className="text-signal-warn">{readError}</p>}
        <p className="text-muted-foreground">
          {saved ? "Named on this robot." : "Found from where the robot walked while mapping."}{" "}
          Height is where the robot stands on that floor.
        </p>
        {rows.length > 0 && (
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-1">
                <input
                  aria-label="Floor name"
                  className="h-6 w-14 min-w-0 rounded-sm border border-hairline bg-transparent px-1 pointer-coarse:h-10"
                  value={row.name}
                  maxLength={FLOOR_NAME_MAX}
                  onChange={(event) => update(row.id, { name: event.target.value })}
                />
                <input
                  aria-label={`Height of ${row.name || "floor"}`}
                  inputMode="decimal"
                  className="readout h-6 w-16 min-w-0 rounded-sm border border-hairline bg-transparent px-1 text-right pointer-coarse:h-10"
                  value={row.level}
                  onChange={(event) => update(row.id, { level: event.target.value })}
                />
                <span className="text-muted-foreground">m</span>
                <button
                  type="button"
                  aria-label={`Remove ${row.name || "floor"}`}
                  title="Remove"
                  className="ml-auto grid size-6 place-items-center rounded-sm text-muted-foreground hover:text-signal-warn pointer-coarse:size-10"
                  onClick={() => edit(rows.filter((other) => other.id !== row.id))}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-hairline px-1.5 hover:text-foreground pointer-coarse:h-10"
            disabled={!ready}
            onClick={() => edit([...rows, ...toRows([nextFloor(parsed)])])}
          >
            <PlusIcon className="size-3" />
            Add floor
          </button>
          {useDetected && detected.length > 0 && (
            <button
              type="button"
              className="h-6 rounded-sm border border-hairline px-1.5 hover:text-foreground pointer-coarse:h-10"
              onClick={() => edit(toRows(detected))}
            >
              Use detected
            </button>
          )}
          {dirty && (
            <button
              type="button"
              className="h-6 rounded-sm border border-hairline px-1.5 hover:text-foreground pointer-coarse:h-10"
              onClick={() => {
                setDraft(null);
                reset();
              }}
            >
              Revert
            </button>
          )}
          <button
            type="button"
            className="ml-auto h-6 rounded-sm border border-signal-cmd bg-signal-cmd/15 px-2 text-signal-cmd disabled:opacity-40 pointer-coarse:h-10"
            disabled={!dirty || problem !== null || isPending}
            title={problem ?? undefined}
            onClick={onSave}
          >
            {isPending ? "Saving…" : "Save floors"}
          </button>
        </div>
        {problem && <p className="text-signal-caution">{problem}</p>}
        {saveError && (
          <p role="alert" className="break-words text-signal-warn">
            Not saved. {saveError.message}
          </p>
        )}
        {message && (
          <p role="status" className="text-signal-live">
            {message}
          </p>
        )}
      </div>
    </details>
  );
}
