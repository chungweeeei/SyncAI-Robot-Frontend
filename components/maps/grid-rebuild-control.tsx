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
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { cn } from "@/lib/utils";
import type { GridRecipe, MapSummary } from "@/lib/types/map";

/**
 * (Re)build a map's floor plan — the card-side face of
 * POST /api/v1/maps/{name}/grid/convert. Offers the two recipes only; the
 * pipeline's tuning knobs stay API-only, since they're tuned against
 * intermediate scans, not guessed from a card.
 *
 * 409 `gridmap_hand_edited` becomes a confirm and a retry with
 * `overwriteEdits` (the edited grid survives as gridmap_prev.pgm either way).
 * Every other failure is the backend's sentence. No local "converting" state:
 * the invalidation makes the catalogue answer `converting`, and useMaps' poll
 * carries the card to `ok` or `failed`.
 */
export function GridRebuildControl({ map }: { map: MapSummary }) {
  const conversion = useConvertMapGrid();
  // A rebuild replaces the planner's floor plan, so it waits for any job on
  // this map (lib/map/run-lock.ts); the backend refuses it anyway.
  const runLock = useMapRunLock(map.name);
  const [confirm, setConfirm] = React.useState<{
    recipe: GridRecipe;
    detail: string;
  } | null>(null);

  const busy = conversion.isPending;
  const message = conversion.data?.message ?? null;
  // The hand-edit conflict is a question, asked in the dialog — never an error.
  const conflict =
    isHandEditConflict(conversion.error) &&
    !conversion.variables?.overwriteEdits;
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

  // Everything but "converting" is rebuildable — a failed conversion most of
  // all, with the other recipe.
  const disabled =
    busy || map.grid_status === "converting" || !map.has_pointcloud;

  const label = map.grid ? "Rebuild" : "Build";
  const trigger =
    "instrument-label flex h-5 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground transition-colors";

  return (
    <div className="mt-2 space-y-1.5">
      {runLock.locked ? (
        // A look-alike span: the disabled trigger swallows the pointer the
        // tooltip needs. Focusable and named with the reason for keyboards.
        <span
          role="button"
          tabIndex={0}
          aria-disabled="true"
          aria-label={`${label}: ${runLock.reason}`}
          title={runLock.reason ?? undefined}
          className={cn(trigger, "w-fit cursor-not-allowed opacity-40")}
        >
          <RefreshCwIcon className="size-3" aria-hidden />
          {label}
          <ChevronDownIcon className="size-3" aria-hidden />
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            className={cn(
              trigger,
              "hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <RefreshCwIcon className="size-3" aria-hidden />
            {label}
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
      )}

      {/* The backend's sentences, verbatim. */}
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
