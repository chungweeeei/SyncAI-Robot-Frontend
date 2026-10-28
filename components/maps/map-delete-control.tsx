"use client";

import * as React from "react";
import { ArrowLeftIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDeleteMap } from "@/hooks/use-map-actions";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

const LOCKED_REASON =
  "The robot is working in this map right now, so it cannot be deleted. Switch it to another map first.";
/**
 * The corner tile, shared by the button and the greyed span; its own
 * `bg-panel` so the glyph doesn't sink into the tile.
 */
const CORNER =
  "absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-sm border border-hairline bg-panel/90 backdrop-blur-sm";

/**
 * The one consequence the title doesn't state: the waypoints go too. They are
 * hand-placed work stored outside the map directory, so they are what can
 * surprise — the size is already on the card. Null when there are none.
 */
function vertexWarning(map: MapSummary): string | null {
  if (map.vertex_count === 0) return null;
  if (map.vertex_count === 1) return "Its saved waypoint goes too.";
  return `Its ${map.vertex_count} saved waypoints go too.`;
}

/**
 * The card-side face of DELETE /api/v1/maps/{name}: an X in the card's top
 * right, not a word in the header, so it can't read as another view. It owns
 * the `absolute` (the card is the positioned ancestor) because its dialog is
 * a sibling, and carries its own surface to contrast with the tile.
 *
 * Confirmed in an AlertDialog (no backdrop dismiss) because nothing is behind
 * it: a rename can be undone, but this removes the run and its waypoints. The dialog names the map and warns
 * about the waypoints, nothing else.
 *
 * The map in use can't be deleted (409 `map_active`): the running stack holds
 * paths into it. Greyed on the active card. A refusal keeps the dialog open — 409
 * `template_bound` names the templates still bound to the map.
 *
 * On success the card unmounts with the refetch, so the sentence goes up
 * through `onDeleted` from the per-call callback, which runs before the
 * refetch lands.
 */
export function MapDeleteControl({
  map,
  onDeleted,
}: {
  map: MapSummary;
  /** The backend's sentence, for a surface that outlives this card. */
  onDeleted?: (message: string) => void;
}) {
  const remove = useDeleteMap();
  const [confirming, setConfirming] = React.useState(false);

  const busy = remove.isPending;
  // 409s (in use, a bound template) arrive as the backend's sentence.
  const error = remove.error?.message ?? null;

  const locked = map.active;

  const submit = () => {
    if (busy) return;
    remove.mutate(map.name, {
      onSuccess: (result) => {
        onDeleted?.(result.message);
        setConfirming(false);
      },
    });
  };

  const close = () => {
    setConfirming(false);
    remove.reset();
  };

  return (
    <>
      {/* A look-alike span when blocked: `disabled` swallows the pointer
        * events the tooltip needs. */}
      {locked ? (
        <span
          aria-disabled="true"
          title={LOCKED_REASON}
          className={cn(CORNER, "cursor-not-allowed text-muted-foreground opacity-40")}
        >
          <XIcon className="size-3.5" aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            remove.reset();
            setConfirming(true);
          }}
          aria-label={`Delete ${map.name}`}
          title={`Delete ${map.name}`}
          className={cn(
            CORNER,
            "text-muted-foreground transition-colors hover:border-signal-warn/50 hover:bg-signal-warn/12 hover:text-signal-warn",
          )}
        >
          <XIcon className="size-3.5" aria-hidden />
        </button>
      )}

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {map.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {vertexWarning(map)} Remapping the site is the only way back.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <p
              role="alert"
              className="text-[11px] leading-tight text-signal-warn"
            >
              {error}
            </p>
          )}

          <AlertDialogFooter>
            {/* Icon and label, the house pattern: the last screen before the
              * map is removed is no place for two unlabelled buttons. */}
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              <ArrowLeftIcon data-icon="inline-start" />
              Keep
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={submit}
            >
              <Trash2Icon data-icon="inline-start" />
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
