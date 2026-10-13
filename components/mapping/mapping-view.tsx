"use client";

import * as React from "react";
import {
  ArrowLeftIcon,
  Grid2x2Icon,
  MapIcon,
  NavigationIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { PointCloudCanvas } from "@/components/dashboard/pointcloud-canvas";
import { ModeControl } from "@/components/mapping/mode-control";
import { RunError } from "@/components/mapping/run-error";
import { RunStrip, type RunPending } from "@/components/mapping/run-strip";
import { SaveMapDialog } from "@/components/mapping/save-map-dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  useMappingStatus,
  useResetMappingRun,
  useSaveMap,
  useStartMapping,
} from "@/hooks/use-mapping-run";
import { useMapConversion } from "@/hooks/use-maps";
import { useModeSwitch } from "@/hooks/use-mode-switch";
import { useTelemetry } from "@/hooks/use-telemetry";
import type { MappingRunState, SwitchableMode } from "@/lib/api/mapping";
import { mappingRunFace } from "@/lib/map/run-face";
import { cn } from "@/lib/utils";

/*
 * No camera-mode control here, unlike the dashboard: the canvas stays on Move.
 * Focus rides the robot, and this screen is about the shape of the room
 * covered so far, which a camera locked to the robot takes away.
 */

/**
 * What the operator is about to do, once they have said yes. `unsaved` is
 * frozen when the dialog opens so a save landing underneath can't rewrite the
 * question.
 */
type Confirming =
  | { kind: "reset" }
  | { kind: "switch"; to: SwitchableMode; unsaved: boolean };

/**
 * The four questions, keyed by `confirmKey`. `leave` and `reset` lose the run;
 * `MANUAL` and `AUTO` destroy nothing but tear the stack down for ~30 s. Only
 * the unrecoverable ones are `destructive`, so red keeps meaning that.
 */
const CONFIRM_COPY = {
  leave: {
    title: "Leave mapping without saving?",
    // `body: null`: the dialog writes its own line (the reset copy depends on `savedRun`).
    body: "This run's map is only in the robot's memory. Switching discards it for good.",
    icon: Trash2Icon,
    confirm: "Discard and switch",
    cancel: "Keep mapping",
    destructive: true,
  },
  reset: {
    title: "Start a new map?",
    body: null,
    icon: RotateCcwIcon,
    confirm: "Discard and start over",
    cancel: "Keep mapping",
    destructive: true,
  },
  MANUAL: {
    title: "Switch to Mapping mode?",
    body: "The robot restarts its software: anything it is doing now stops, and this console loses contact for about 30 seconds.",
    icon: MapIcon,
    confirm: "Switch to Mapping",
    cancel: "Cancel",
    destructive: false,
  },
  AUTO: {
    title: "Switch to Nav mode?",
    body: "The robot restarts its software on the map in use: anything it is doing now stops, and this console loses contact for about 30 seconds.",
    icon: NavigationIcon,
    confirm: "Switch to Nav",
    cancel: "Cancel",
    destructive: false,
  },
} as const;

function confirmKey(confirming: Confirming): keyof typeof CONFIRM_COPY {
  if (confirming.kind === "reset") return "reset";
  return confirming.unsaved ? "leave" : confirming.to;
}

/**
 * The mapping screen: drive the robot around and watch the map being built.
 *
 * Not gated on robot state like the dashboard: the mode switch, when the
 * backend is down and there is no state, is this screen's defining moment, and
 * blanking then would hide "Switching".
 *
 * No map meta or ground image — in MANUAL what is on screen *is* the map. The
 * dim "map so far" is the loop-closure-corrected keyframe scan, streamed while
 * a mapping session is up; the live scan rides on top over the dashboard's
 * socket. The robot model needs a telemetry pose mapping may not provide; the
 * scans are the instrument either way.
 *
 * The strip's face is the robot's polled run state (lib/map/run-face.ts), not
 * a flag set on a press, so a run started or saved from another console, or
 * a reload, reads the same.
 *
 * This page owns start, save and reset: a refused start or reset lands in one
 * panel under the strip, and the save's receipt outlives its dialog. Each press
 * `reset()`s the other two, so the last press owns the panel and a new run
 * never reopens on the previous save's receipt.
 *
 * **Every act that rebuilds or discards goes through one confirm dialog**,
 * since nothing downstream stops it: the mode manager takes a switch at its
 * word and the run lives in RAM. Both mode segments confirm, since either
 * direction tears the stack down for ~30 s. `savedRun` decides how loud
 * leaving MANUAL is ("restart" vs "map gone"); it re-arms on a new MANUAL
 * session (watching `reported`), a successful reset and a successful start —
 * the last two explicitly, as `reported` doesn't move across them. A run state
 * of `idle` lifts the guard (nothing in RAM); `unknown` keeps it.
 *
 * A start has no confirm: it discards nothing, and the robot refuses one while
 * a run is on.
 */
export function MappingView() {
  const control = useModeSwitch();
  const { feed } = useTelemetry();
  const [topDownNonce, setTopDownNonce] = React.useState(0);
  const [savedRun, setSavedRun] = React.useState(false);
  // One dialog for every question: they differ only in what happens next, and
  // two copies would drift apart.
  const [confirming, setConfirming] = React.useState<Confirming | null>(null);
  // Never open with the confirm: it is reached from the strip, which is inert under it.
  const [saving, setSaving] = React.useState(false);

  const start = useStartMapping();
  const save = useSaveMap();
  const discard = useResetMappingRun();

  const { reported, pending, switchTo } = control;

  // A new MANUAL run re-arms the save guard.
  const [prevReported, setPrevReported] = React.useState(reported);
  if (reported !== prevReported) {
    setPrevReported(reported);
    if (reported === "MANUAL") setSavedRun(false);
  }

  const mapping = reported === "MANUAL" && !pending;

  // Polled only while Mapping; elsewhere the answer is `unknown`. Loading
  // fails closed, offering nothing.
  const runStatus = useMappingStatus(mapping);
  const runState: MappingRunState =
    mapping && runStatus.run ? runStatus.run.state : "unknown";
  const face = mappingRunFace({
    inMapping: mapping,
    run: runStatus.run,
    status: runStatus.status,
  });

  // The map this screen follows the conversion of, read off the last save —
  // the catalogue can't say which map is "the one I just saved". Null unless
  // a conversion started, which also spares this screen the catalogue fetch.
  const watching = save.data?.grid_pending ? save.data.name : null;
  const converting = useMapConversion(watching);

  // Every segment opens the dialog; the second tap is what commands. The mode
  // already reported does nothing — re-selecting it is not a request.
  const selectMode = React.useCallback(
    (mode: SwitchableMode) => {
      if (mode === reported && !pending) return;
      setConfirming({
        kind: "switch",
        to: mode,
        // Only MANUAL → AUTO loses a run, and only while the robot holds one:
        // `idle` has nothing in RAM; `unknown` fails closed and warns.
        unsaved:
          mode === "AUTO" && reported === "MANUAL" && runState !== "idle" && !savedRun,
      });
    },
    [reported, pending, savedRun, runState],
  );

  const onStart = () => {
    save.reset();
    discard.reset();
    start.mutate(undefined, {
      // A start after a save is a new unsaved run `reported` never sees.
      onSuccess: () => setSavedRun(false),
    });
  };

  // Cleared on open, not submit: a receipt from another console's save would
  // otherwise flash as this one's.
  const openSave = () => {
    start.reset();
    discard.reset();
    save.reset();
    setSaving(true);
  };

  const submitSave = (name: string) => {
    save.mutate(name, { onSuccess: () => setSavedRun(true) });
  };

  // A refusal backed out of is dropped, so the dialog reopens empty.
  const closeSave = () => {
    if (save.error) save.reset();
    setSaving(false);
  };

  const runReset = () => {
    setConfirming(null);
    start.reset();
    save.reset();
    discard.mutate(undefined, {
      onSuccess: () => {
        // `reported` stays MANUAL through a reset, so without this a save of A,
        // reset, drive B, switch to Nav would lose B with no warning.
        setSavedRun(false);
      },
    });
  };

  // Confirmed even when saved: the minutes driven since the save are still lost.
  const requestReset = React.useCallback(
    () => setConfirming({ kind: "reset" }),
    [],
  );

  // The last question, held past close so the copy doesn't change under the
  // close animation (adjust-during-render, as above).
  const [shown, setShown] = React.useState<Confirming>({ kind: "reset" });
  if (confirming && confirming !== shown) setShown(confirming);
  const confirmCopy = CONFIRM_COPY[confirmKey(shown)];
  const ConfirmIcon = confirmCopy.icon;

  const confirmDialog = () => {
    if (!confirming) return;
    if (confirming.kind === "reset") {
      runReset();
      return;
    }
    const target = confirming.to;
    setConfirming(null);
    // A switch tears the session down; the receipts describe a dead run.
    start.reset();
    save.reset();
    discard.reset();
    void switchTo(target);
  };

  const runPending: RunPending = start.isPending
    ? "start"
    : save.isPending
      ? "save"
      : discard.isPending
        ? "reset"
        : null;

  // At most one holds an error, since each press resets the others. The
  // save's refusal stays in its dialog.
  const runError = start.error?.message ?? discard.error?.message ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section
        aria-label="Mapping viewport"
        className="relative h-[55svh] shrink-0 lg:h-full lg:flex-1"
      >
        <PointCloudCanvas
          telemetry={feed}
          topDownNonce={topDownNonce}
          mapCloudStream
        />

        {/* The run strip top right, a refused press under it. The overlay is
          * pointer-transparent so its empty stretches still pass a drag to
          * the scene. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
          <RunStrip
            className="pointer-events-auto self-end"
            face={face}
            pending={runPending}
            onStart={onStart}
            onSave={openSave}
            onReset={requestReset}
          />

          {/* Scrolls: a phone held sideways leaves ~200 px, and a refusal
            * can be three lines. */}
          <div className="pointer-events-none flex min-h-0 w-56 flex-col gap-2 self-end overflow-y-auto empty:hidden">
            <RunError className="pointer-events-auto" message={runError} />
          </div>
        </div>

        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTopDownNonce((n) => n + 1)}
            title="Look straight down at the map"
            className={cn(
              overlayPanel,
              "instrument-label flex h-6 items-center gap-1.5 px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground",
            )}
          >
            <Grid2x2Icon aria-hidden className="size-3.5" />
            Top down
          </button>
        </div>
      </section>

      <aside
        aria-label="Mapping controls"
        className="w-full shrink-0 border-t border-hairline bg-panel lg:h-full lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <ModeControl control={control} onSelect={selectMode} />
      </aside>

      <SaveMapDialog
        open={saving}
        busy={save.isPending}
        error={save.error?.message ?? null}
        saved={save.data?.message ?? null}
        conversion={converting}
        onSave={submitSave}
        onClose={closeSave}
      />

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmCopy.body ?? (
                <>
                  {savedRun
                    ? "Anything driven since the last save is discarded."
                    : "This run's map is discarded for good."}{" "}
                  Keep the robot still while the lidar re-levels.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* Icon and label, the house pattern; the confirm glyph is the one
              * the action wears on this page (RotateCcw is New map). */}
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              <ArrowLeftIcon data-icon="inline-start" />
              {confirmCopy.cancel}
            </Button>
            <Button
              variant={confirmCopy.destructive ? "destructive" : "default"}
              size="sm"
              onClick={confirmDialog}
            >
              <ConfirmIcon data-icon="inline-start" />
              {confirmCopy.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
