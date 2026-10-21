"use client";

import * as React from "react";
import { ArrowLeftIcon, ArrowLeftRightIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useActivateMap } from "@/hooks/use-map-actions";
import { switchRefusal } from "@/lib/map/switch";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

/**
 * The corner tile, MapDeleteControl's shape on the opposite side; shared by
 * the button and the greyed span, with its own `bg-panel` so the glyph doesn't
 * sink into the thumbnail. It is the slot of MapCard's in-use badge — the two
 * are mutually exclusive, so one tile sits there on every card.
 */
const CORNER =
  "absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-sm border border-hairline bg-panel/90 backdrop-blur-sm";

/**
 * The card-side face of POST /api/v1/maps/{name}/activate: swap arrows in the
 * in-use badge's corner, rendered only when the map is not active.
 *
 * Swap arrows rather than an outlined check, which would read as "done,
 * greyed out" and be confused with the real greyed state. `ArrowLeftRight`,
 * to stay clear of Rebuild's `RefreshCw`. Greyed, with the reason in the
 * tooltip, for a map with neither a floor plan nor a 3D map, no scan, or
 * mid-conversion (`switchRefusal`) — a span look-alike, since `disabled`
 * swallows the tooltip's pointer events.
 *
 * Confirmed in an AlertDialog that names the map, because the consequence
 * isn't guessable from an arrow: the pose resets to the new map's origin and
 * must be set again (an old-frame pose would be meaningless there). One
 * sentence, no backdrop dismiss — every extra line is read instead of the one
 * that asks for action.
 *
 * A refusal keeps the dialog open, which matters for 409 `task_running`: it
 * names the running tasks. On success the badge moves here, so the sentence
 * goes up through `onSwitched` — it is about the robot and outlives the
 * dialog. Cache consequences live in useActivateMap.
 */
export function MapActivateControl({
  map,
  onSwitched,
}: {
  map: MapSummary;
  /** The backend's sentence, for a surface that is not this card. */
  onSwitched?: (message: string) => void;
}) {
  const activate = useActivateMap();
  const [confirming, setConfirming] = React.useState(false);

  const busy = activate.isPending;
  // Every refusal is the backend's sentence; ActivateConflictError's code isn't
  // branched on, since none has a retry to offer here.
  const error = activate.error?.message ?? null;

  const submit = () => {
    if (busy) return;
    activate.mutate(map.name, {
      onSuccess: (result) => {
        onSwitched?.(result.message);
        setConfirming(false);
      },
    });
  };

  const close = () => {
    setConfirming(false);
    activate.reset();
  };

  if (map.active) return null;

  const reason = switchRefusal(map);

  return (
    <>
      {reason ? (
        <span
          aria-disabled="true"
          title={reason}
          className={cn(CORNER, "cursor-not-allowed text-muted-foreground opacity-40")}
        >
          <ArrowLeftRightIcon className="size-3.5" aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          onClick={() => {
            activate.reset();
            setConfirming(true);
          }}
          aria-label={`Switch the robot to ${map.name}`}
          title={`Switch the robot to ${map.name}`}
          className={cn(
            CORNER,
            "text-muted-foreground transition-colors hover:border-signal-cmd/50 hover:bg-signal-cmd/12 hover:text-signal-cmd",
          )}
        >
          <ArrowLeftRightIcon className="size-3.5" aria-hidden />
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
            <AlertDialogTitle>Switch to {map.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The robot&apos;s pose resets to this map&apos;s origin — set an
              initial pose on the dashboard afterwards.
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
            {/* Icon and label, the house pattern. Not `destructive` — nothing
              * is destroyed, and the delete dialog needs the louder red. */}
            <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
              <ArrowLeftIcon data-icon="inline-start" />
              Cancel
            </Button>
            <Button size="sm" disabled={busy} onClick={submit}>
              <ArrowLeftRightIcon data-icon="inline-start" />
              {busy ? "Switching…" : "Switch"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
