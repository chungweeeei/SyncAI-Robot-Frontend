"use client";

import * as React from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { isHandEditConflict, useConvertMapGrid } from "@/hooks/use-map-actions";
import type { GridRecipe, MapSummary } from "@/lib/types/map";

/**
 * (Re)build a map's 2D gridmap — the card-side face of
 * POST /api/v1/maps/{name}/grid/convert.
 *
 * This is the formal home of what field operators used to do over SSH with a
 * one-off script: pick the recipe when the default is wrong for the site. The
 * dropdown carries exactly the two recipes and nothing else — band offsets,
 * gap_fill_size and the debug switch stay API-only on purpose, because they are
 * tuned with the pipeline's intermediate clouds in front of you, not guessed
 * from a card.
 *
 * The hand-edit conflict is the one flow with structure: the backend answers
 * 409 `gridmap_hand_edited` for a map whose grid holds operator edits, and this
 * control turns that into a confirm dialog and a retry with `overwriteEdits`
 * rather than a dead error — the edited grid survives as gridmap_prev.pgm
 * either way, and the dialog says so. A `conversion_running` 409 and every
 * other failure just render as the backend's own sentence.
 *
 * There is no local "converting" state to hold, and no completion to report
 * either: useConvertMapGrid invalidates the maps query, the catalogue answers
 * with `grid_status: "converting"`, and useMaps' poll carries the card through
 * to `ok` or to `failed` with its reason. What this control owns is the
 * request — everything after it belongs to the card.
 */
export function GridRebuildControl({ map }: { map: MapSummary }) {
  const conversion = useConvertMapGrid();
  const [confirm, setConfirm] = React.useState<{
    recipe: GridRecipe;
    detail: string;
  } | null>(null);

  const busy = conversion.isPending;
  const message = conversion.data?.message ?? null;
  // The hand-edit conflict is a question, not a failure: it is asked in the
  // dialog below and never rendered as an error, whether the dialog is open or
  // was answered "keep". Every other refusal is the backend's sentence.
  const conflict =
    isHandEditConflict(conversion.error) && !conversion.variables?.overwriteEdits;
  const error = conflict ? null : (conversion.error?.message ?? null);

  const convert = (recipe: GridRecipe, overwriteEdits: boolean) => {
    conversion.mutate(
      { name: map.name, recipe, overwriteEdits },
      {
        onError: (cause) => {
          if (isHandEditConflict(cause) && !overwriteEdits) {
            setConfirm({ recipe, detail: cause.message });
          }
        },
      },
    );
  };

  // Every state but "converting" is rebuildable, failures included — a failed
  // conversion is in fact the state most likely to want this control, with the
  // other recipe.
  const disabled =
    busy || map.grid_status === "converting" || !map.has_pointcloud;

  return (
    <div className="mt-2 space-y-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          className="instrument-label flex h-5 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <RefreshCwIcon className="size-3" aria-hidden />
          {map.grid ? "Rebuild floor plan" : "Build floor plan"}
          <ChevronDownIcon className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuItem onClick={() => convert("z-band", false)}>
            <div>
              <p className="text-sm">Standard</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Anywhere the robot did not see stays open, so you can fix it
                later by driving through it or editing the map. The safe choice
                on a new site.
              </p>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => convert("traversability", false)}>
            <div>
              <p className="text-sm">Strict</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                For sites too large to tidy up by hand. Anywhere the robot did
                not see becomes a wall it will never cross — choose this
                deliberately.
              </p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The backend's sentences, verbatim — same contract as SaveMapControl. */}
      {message && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-tight text-signal-warn">
          {error}
        </p>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.detail ??
                "This map's floor plan has been edited by hand. Rebuilding replaces those edits."}{" "}
              A copy of the edited version is kept on the robot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Keep my edits
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!confirm) return;
                const { recipe } = confirm;
                setConfirm(null);
                convert(recipe, true);
              }}
            >
              Rebuild anyway
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
