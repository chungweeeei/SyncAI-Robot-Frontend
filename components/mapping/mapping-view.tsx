"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeftIcon,
  Grid2x2Icon,
  MapIcon,
  NavigationIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";

import { ViewportBoundary } from "@/components/console/fault-boundary";
import { overlayPanel } from "@/components/console/instrument";
import { ModeControl } from "@/components/mapping/mode-control";
import { ResumeMapDialog } from "@/components/mapping/resume-map-dialog";
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
  useResumeMapping,
  useSaveMap,
  useStartMapping,
} from "@/hooks/use-mapping-run";
import { useMapBuild } from "@/hooks/use-maps";
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
 * question, and `resumedFrom` (the saved map the run continues, or null) for
 * the same reason: the reset it confirms clears it.
 */
type Confirming =
  | { kind: "reset"; resumedFrom: string | null }
  | { kind: "switch"; to: SwitchableMode; unsaved: boolean; resumedFrom: string | null };

/**
 * The four questions, keyed by `confirmKey`. `leave` and `reset` lose the run;
 * `MANUAL` and `AUTO` destroy nothing but tear the stack down for ~30 s. Only
 * the unrecoverable ones are `destructive`, so red keeps meaning that.
 */
/**
 * In its own chunk and client-only, as on the dashboard: the 3D library is
 * most of this route's script. The blank fills the viewport's section.
 */
const PointCloudCanvas = dynamic(
  () => import("@/components/dashboard/pointcloud-canvas").then((mod) => mod.PointCloudCanvas),
  { ssr: false, loading: () => <div aria-hidden className="h-full w-full" /> },
);

const CONFIRM_COPY = {
  leave: {
    title: "Leave mapping without saving?",
    body: "This run's map is only in the robot's memory. Switching discards it for good.",
    icon: Trash2Icon,
    confirm: "Discard and switch",
    cancel: "Keep mapping",
    destructive: true,
  },
  reset: {
    title: "Start a new map?",
    // `confirmBody` writes it: the line depends on `savedRun` and on a resume.
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
 * The question's second line. A run resumed from a saved map loses less and
 * differently: the saved map is still on the robot, only what the run added
 * goes — and a reset does not go back to it, it starts an empty map, which is
 * the one thing an operator would not guess.
 */
function confirmBody(confirming: Confirming, savedRun: boolean): string {
  const key = confirmKey(confirming);
  const from = confirming.resumedFrom;
  if (key === "leave" && from !== null) {
    return `What this run added to ${from} is only in the robot's memory. Switching discards it for good; ${from} itself stays as it was saved.`;
  }
  if (key === "reset") {
    const still = "Keep the robot still while the lidar re-levels.";
    if (from !== null) {
      return `What this run added to ${from} is discarded for good, and the robot starts a new, empty map: ${from} stays as it was saved, but is no longer what the run builds on — resume it again for that. ${still}`;
    }
    return `${
      savedRun
        ? "Anything driven since the last save is discarded."
        : "This run's map is discarded for good."
    } ${still}`;
  }
  return CONFIRM_COPY[key].body ?? "";
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
 * This page owns start, resume, save and reset: a refused start or reset
 * lands in one panel under the strip, a refused resume or save in its own
 * dialog, and the save's receipt outlives its dialog. Each press `reset()`s
 * the others, so the last press owns the panel and a new run never reopens
 * on the previous save's receipt.
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
 * a run is on. Nor has a resume, beyond its own dialog, for the same reason.
 *
 * `resumedFrom` is the saved map a resumed run continues. The robot's status
 * never says a run was resumed — only the resume's own answer does — so it is
 * this console's memory of its own press, like `savedRun`: a reload, or a
 * resume from another console, has none, and the strip, the save dialog and
 * the confirms fall back to a plain run's words (the robot still refuses a
 * save into the old name). It is dropped by whatever ends or replaces the
 * run: a start, a reset, a save, a new session, and the robot reading idle.
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
  const [resuming, setResuming] = React.useState(false);
  const [resumedFrom, setResumedFrom] = React.useState<string | null>(null);

  const start = useStartMapping();
  const resume = useResumeMapping();
  const save = useSaveMap();
  const discard = useResetMappingRun();

  const { reported, pending, switchTo } = control;

  // A new MANUAL run re-arms the save guard.
  const [prevReported, setPrevReported] = React.useState(reported);
  if (reported !== prevReported) {
    setPrevReported(reported);
    if (reported === "MANUAL") setSavedRun(false);
    // Either way the run that was resumed is gone with its session.
    setResumedFrom(null);
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

  // A run that ended somewhere else (another console's save) is no longer the
  // one resumed. On the turn to idle only: a resume the robot answers at once
  // lands while the last read still says idle, and must not be dropped by it.
  const [prevRunState, setPrevRunState] = React.useState(runState);
  if (runState !== prevRunState) {
    setPrevRunState(runState);
    if (runState === "idle") setResumedFrom(null);
  }

  // The map this screen follows the 3D map build of, read off the last save —
  // the catalogue can't say which map is "the one I just saved". Null until a
  // save, which also spares this screen the catalogue fetch.
  const watching = save.data ? save.data.name : null;
  const converting = useMapBuild(watching);

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
        resumedFrom,
      });
    },
    [reported, pending, savedRun, runState, resumedFrom],
  );

  const onStart = () => {
    save.reset();
    discard.reset();
    resume.reset();
    start.mutate(undefined, {
      // A start after a save is a new unsaved run `reported` never sees.
      onSuccess: () => {
        setSavedRun(false);
        setResumedFrom(null);
      },
    });
  };

  // Cleared on open, as the save's: the last resume's receipt or refusal is
  // not this one's.
  const openResume = () => {
    start.reset();
    discard.reset();
    save.reset();
    resume.reset();
    setResuming(true);
  };

  const submitResume = (name: string) => {
    resume.mutate(
      { name },
      {
        // The answer's name, not the one sent: it is the robot's word for
        // which map the run stands on. A new unsaved run, as a start is.
        onSuccess: (result) => {
          setSavedRun(false);
          setResumedFrom(result.name);
        },
      },
    );
  };

  // A refusal backed out of is dropped, so the strip is not left holding it.
  const closeResume = () => {
    if (resume.error) resume.reset();
    setResuming(false);
  };

  // Cleared on open, not submit: a receipt from another console's save would
  // otherwise flash as this one's.
  const openSave = () => {
    start.reset();
    discard.reset();
    resume.reset();
    save.reset();
    setSaving(true);
  };

  const submitSave = (name: string) => {
    save.mutate(
      { name },
      {
        onSuccess: () => {
          setSavedRun(true);
          // The save ended the run; the next one starts from nothing.
          setResumedFrom(null);
        },
      },
    );
  };

  // The receipt's own question, so no second confirm: the run is saved and
  // the receipt has said which map Navigation comes back on. The save is not
  // reset here, unlike the confirm's switch: the dialog would turn back into
  // the form under its close animation, and the next open clears it anyway.
  const saveThenSwitch = () => {
    setSaving(false);
    void switchTo("AUTO");
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
    resume.reset();
    discard.mutate(undefined, {
      onSuccess: () => {
        // `reported` stays MANUAL through a reset, so without this a save of A,
        // reset, drive B, switch to Nav would lose B with no warning.
        setSavedRun(false);
        // A reset starts an empty map; the saved one is no longer under it.
        setResumedFrom(null);
      },
    });
  };

  // Confirmed even when saved: the minutes driven since the save are still lost.
  const requestReset = React.useCallback(
    () => setConfirming({ kind: "reset", resumedFrom }),
    [resumedFrom],
  );

  // The last question, held past close so the copy doesn't change under the
  // close animation (adjust-during-render, as above).
  const [shown, setShown] = React.useState<Confirming>({ kind: "reset", resumedFrom: null });
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
    resume.reset();
    void switchTo(target);
  };

  const runPending: RunPending = start.isPending
    ? "start"
    : resume.isPending
      ? "resume"
      : save.isPending
        ? "save"
        : discard.isPending
          ? "reset"
          : null;

  // At most one holds an error, since each press resets the others. The
  // save's refusal stays in its dialog, and the resume's in its own.
  const runError = start.error?.message ?? discard.error?.message ?? null;

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section
        aria-label="Mapping viewport"
        className="relative h-[55svh] shrink-0 short:h-full lg:h-full lg:flex-1"
      >
        <ViewportBoundary>
          {/* The mode is the pose's frame: a switch moves the robot from the
            * loaded map's to a mapping run's, or back, and the view follows. */}
          <PointCloudCanvas
            telemetry={feed}
            poseFrame={reported}
            topDownNonce={topDownNonce}
            mapCloudStream
          />
        </ViewportBoundary>

        {/* The run strip top right, a refused press under it. The overlay is
          * pointer-transparent so its empty stretches still pass a drag to
          * the scene. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
          <RunStrip
            className="pointer-events-auto self-end"
            face={face}
            pending={runPending}
            // Only beside a run: the turn to idle clears it a render later.
            resumedFrom={face.kind === "run" ? resumedFrom : null}
            onStart={onStart}
            onResume={openResume}
            onSave={openSave}
            onReset={requestReset}
          />

          {/* Scrolls: a phone held sideways leaves ~200 px, and a refusal
            * can be three lines. */}
          <div className="pointer-events-none flex min-h-0 w-56 max-w-full flex-col gap-2 self-end overflow-y-auto empty:hidden">
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
              "instrument-label flex h-6 items-center gap-1.5 px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:h-10 pointer-coarse:px-3",
            )}
          >
            <Grid2x2Icon aria-hidden className="size-3.5" />
            Top down
          </button>
        </div>
      </section>

      <aside
        aria-label="Mapping controls"
        className="w-full shrink-0 border-t border-hairline bg-panel lg:h-full lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l 2xl:w-80"
      >
        {/* Capped below lg: at a tablet's width the two-way switch was a
          * 700 px control. */}
        <div className="max-lg:max-w-md">
          <ModeControl control={control} onSelect={selectMode} />
        </div>
      </aside>

      <ResumeMapDialog
        open={resuming}
        busy={resume.isPending}
        error={resume.error?.message ?? null}
        resumed={resume.data?.message ?? null}
        onResume={submitResume}
        onClose={closeResume}
      />

      <SaveMapDialog
        open={saving}
        busy={save.isPending}
        error={save.error?.message ?? null}
        saved={save.data?.message ?? null}
        conversion={converting}
        switchHeld={control.busy || pending !== null}
        resumedFrom={resumedFrom}
        onSave={submitSave}
        onSwitchToNav={saveThenSwitch}
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
            <AlertDialogDescription className="break-words">
              {confirmBody(shown, savedRun)}
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
