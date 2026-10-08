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
 * There is no camera-mode control here, unlike the dashboard's viewport
 * (components/dashboard/pointcloud-view.tsx, which keeps both). The canvas runs
 * on its `cameraMode` default, Move, and Focus — the mode that keeps the camera
 * locked on the robot — is not offered on this screen for now.
 *
 * Mapping is the one screen where the view is not about where the robot is. The
 * operator is driving it around to grow a cloud, and what they are reading is
 * the shape of the room that has been covered so far and the hole that has not;
 * a camera that rides the robot takes exactly that judgement away, and the run
 * is long enough that it is the judgement the whole screen is for. The
 * top-down button beside where this used to sit is the framing that question
 * actually wants.
 */

/**
 * What the operator is about to do, once they have said yes.
 *
 * `unsaved` is frozen when the dialog opens rather than read at render: it is
 * the reason the dialog says what it says, and a save landing underneath an
 * open dialog must not rewrite the question being asked.
 */
type Confirming =
  | { kind: "reset" }
  | { kind: "switch"; to: SwitchableMode; unsaved: boolean };

/**
 * The four questions this page can ask, keyed by `confirmKey` below.
 *
 * `leave` and `reset` are the two ways to lose the run; `MANUAL` and `AUTO` are
 * the plain mode switches, which destroy nothing but do tear the whole stack
 * down for ~30 s. Hence `destructive`: the red is spent only where something is
 * actually unrecoverable, so it keeps meaning that (same rule as the map
 * library's Switch-vs-Delete dialogs).
 */
const CONFIRM_COPY = {
  leave: {
    title: "Leave mapping without saving?",
    // `body: null` means the dialog writes its own line — the reset copy is the
    // one that depends on state (`savedRun`).
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

/** Which copy a pending confirmation reads. */
function confirmKey(confirming: Confirming): keyof typeof CONFIRM_COPY {
  if (confirming.kind === "reset") return "reset";
  return confirming.unsaved ? "leave" : confirming.to;
}

/**
 * The mapping screen's content: drive the robot around and watch the map being
 * built.
 *
 * The same viewport-plus-rail shape as the dashboard, but deliberately NOT
 * gated on the robot state the way that page is: this screen's defining moment
 * is the mode switch, during which the backend is down and there is no state —
 * a page that blanked itself right then would go dark exactly when the
 * operator needs to see "Switching" holding steady.
 *
 * The canvas gets no map meta and no ground image: in MANUAL there is no
 * loaded map — what is on screen IS the map. Two layers say how the run is
 * going: the dim "map so far" layer is pgo's merged keyframe cloud
 * (loop-closure-corrected — watch it snap into shape when a loop closes),
 * streamed only while a mapping session is up, and the bright live scan rides
 * on top of it over the same body_cloud WebSocket as the dashboard (pgo
 * broadcasts the map TF during mapping, so that stream works unchanged). The
 * robot model needs the telemetry pose, which mapping's TF chain may not
 * provide; the clouds are the primary instrument either way.
 *
 * The run's controls sit over the viewport as one strip (RunStrip), and the
 * rail keeps only the mode switch. The strip's face is the robot's run state,
 * polled, not a flag this page sets on a press: a run started from another
 * console, or a save that landed there, must read the same here, and after a
 * reload the strip has to know whether Start or Save is the next thing to
 * offer. The rule is lib/map/run-face.ts.
 *
 * This page owns the three run writes — start, save, reset — because a
 * refused start or reset lands in the same panel under the strip, and the
 * save's receipt has to outlive a dialog that stays open as it. Whichever was
 * pressed last owns the panel: every press `reset()`s the other two (the
 * recorder's idiom), which is also what clears a save's receipt and its
 * floor plan line when the next run starts — a dialog reopened on "Saved
 * 'foo'" for a brand-new empty map would be a lie about this run.
 *
 * The one rule this page owns: **every act that rebuilds or discards something
 * goes through one confirm dialog**, because nothing downstream will stop you —
 * sys_manager takes `switch_mode` at its word and pgo holds the run in RAM. So
 * both mode segments confirm, not just the one that loses a map: a switch in
 * either direction tears the stack down for ~30 s and stops whatever the robot
 * was doing, which is not something to hand to a stray tap on a touchscreen.
 * What differs is how loud the dialog is — `savedRun` is what escalates leaving
 * MANUAL from "the stack restarts" to "the map is gone". It re-arms on three
 * events that look nothing alike: a new MANUAL session, tracked by watching
 * `reported` change (the adjust-during-render pattern, same as
 * VertexMoveDialog's `shown`), a successful reset, and a successful start —
 * the last two have to say so explicitly because `reported` never moves across
 * either. The guard is also lifted by the robot itself: once the run state
 * reads `idle` (after a save, or before any start) there is nothing in RAM to
 * lose, so leaving is a plain switch. `unknown` keeps the guard, the way the
 * map job lock refuses rather than assumes.
 *
 * A start goes through **no confirm dialog**, and that is a decision against
 * the rule above: a start rebuilds nothing and discards nothing — the stack
 * stays up and there is no run to lose, which the robot itself guarantees by
 * refusing a start while a run is on. Its one hazard, the robot having to
 * stand still while the lidar re-levels, is in the sentence the robot answers
 * with — which, since the panel under the strip keeps only refusals
 * (2026-10, by request), is no longer on screen.
 */
export function MappingView() {
  const control = useModeSwitch();
  const { feed } = useTelemetry();
  const [topDownNonce, setTopDownNonce] = React.useState(0);
  const [savedRun, setSavedRun] = React.useState(false);
  // One dialog, every question. They all ask "you are about to interrupt the
  // robot" and differ only in what happens next, so a second AlertDialog block
  // would be a copy of the same copy, drifting apart at the first reword.
  const [confirming, setConfirming] = React.useState<Confirming | null>(null);
  // The save dialog is the other one, and never open at the same time: it is
  // reached from the strip, which is inert under the confirm.
  const [saving, setSaving] = React.useState(false);

  const start = useStartMapping();
  const save = useSaveMap();
  const discard = useResetMappingRun();

  const { reported, pending, switchTo } = control;

  // A new MANUAL run means the save guard re-arms — whatever was saved last
  // run says nothing about this one.
  const [prevReported, setPrevReported] = React.useState(reported);
  if (reported !== prevReported) {
    setPrevReported(reported);
    if (reported === "MANUAL") setSavedRun(false);
  }

  const mapping = reported === "MANUAL" && !pending;

  // Polled only while the robot reports Mapping: outside it the answer is
  // `unknown` by construction and the query is not even fetched. Loading fails
  // closed, which offers nothing.
  const runStatus = useMappingStatus(mapping);
  const runState: MappingRunState =
    mapping && runStatus.run ? runStatus.run.state : "unknown";
  const face = mappingRunFace({
    inMapping: mapping,
    run: runStatus.run,
    status: runStatus.status,
  });

  // The map whose conversion this screen is following, read off the last save:
  // "the one I just saved" is not something the catalogue can be asked, since
  // it lists every map on the robot and says nothing about which one is this
  // operator's. Watched after every successful save, not only when the
  // backend says a floor plan conversion started: the robot builds its 3D map
  // from the same save on its own, whatever `grid_pending` says, and each
  // receipt line renders nothing while its own status is "none". Null until a
  // save lands, which is also what keeps the mapping screen from fetching a
  // catalogue it otherwise has no use for.
  const watching = save.data?.name ?? null;
  const converting = useMapConversion(watching);

  // No segment commands a switch directly — every one of them opens the dialog
  // and the operator's second tap is what reaches sys_manager. The one press
  // that still does nothing is the mode already reported: re-selecting it is
  // not a request (sys_manager refuses to rebuild the live mode anyway), so
  // asking about it would be a dialog whose yes does nothing.
  const selectMode = React.useCallback(
    (mode: SwitchableMode) => {
      if (mode === reported && !pending) return;
      setConfirming({
        kind: "switch",
        to: mode,
        // Only leaving MANUAL can lose a run — and only towards AUTO, since
        // re-selecting MANUAL to cancel a pending switch keeps the run alive.
        // And only while the robot holds one: `idle` means nothing is in RAM
        // (saved, or never started); `unknown` fails closed and still warns.
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
      // The third re-arm event (see the component doc): a start after a save
      // is a new unsaved run that `reported` never sees.
      onSuccess: () => setSavedRun(false),
    });
  };

  // Cleared on open, not on submit: a receipt from a run another console
  // saved and restarted would otherwise show as this save's for a frame.
  const openSave = () => {
    start.reset();
    discard.reset();
    save.reset();
    setSaving(true);
  };

  const submitSave = (name: string) => {
    save.mutate(name, { onSuccess: () => setSavedRun(true) });
  };

  // A refusal the operator backed out of was shown in the dialog and is
  // dropped with it, so the dialog reopens on an empty form.
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
        // The line that makes the leave-guard keep working. Its usual re-arm
        // watches `reported` change, and `reported` stays MANUAL straight
        // through a reset — so without this, an operator who saves map A,
        // resets, drives map B and then switches to Nav gets no warning and
        // loses B silently.
        setSavedRun(false);
      },
    });
  };

  // Confirmed even when the run IS saved: a misclick costs the run either way,
  // and "it was saved" says nothing about the minutes driven since the save.
  const requestReset = React.useCallback(
    () => setConfirming({ kind: "reset" }),
    [],
  );

  // The last question asked, held past the dialog closing so its copy does not
  // change under the close animation (adjust-during-render, as above). Reading
  // `confirming` directly would mean guarding every line of text for the null
  // frame the operator never sees.
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
    // A switch tears the session down; the receipts describe a run that no
    // longer exists.
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

  // Whichever press was refused last — at most one holds an error, since
  // every press resets the other two. The save's refusal stays in its dialog,
  // beside the name to fix.
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

        {/* The run strip at the top right, a refused press hanging under
          * it. No stream-health pills and no layer toggle (2026-10, by
          * request): the map so far is always streamed, and whether there is
          * any is read off the picture itself. The whole overlay is
          * pointer-transparent so the scene behind its empty stretches still
          * takes a drag — only the panels themselves catch the pointer. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
          <RunStrip
            className="pointer-events-auto self-end"
            face={face}
            pending={runPending}
            onStart={onStart}
            onSave={openSave}
            onReset={requestReset}
          />

          {/* Right-aligned, under the strip whose press it answers. Scrolling
            * because a phone held sideways leaves the viewport ~200 px tall,
            * and a refusal can be three lines. */}
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
            {/* Icon and label both, the house pattern (see the map library's
              * delete and switch dialogs): the glyph tells the two buttons
              * apart at a glance, the word is what makes the committing one
              * unmistakable. The confirm glyph is the one the action already
              * wears elsewhere on this page — RotateCcw is the strip's New
              * map — so the dialog reads as that control continued. */}
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
