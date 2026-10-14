"use client";

import * as React from "react";

import { Readout, overlayPanel } from "@/components/console/instrument";
import { GroundCanvas, type GroundHover, type GroundTool } from "@/components/maps/ground-canvas";
import { GroundToolBar } from "@/components/maps/ground-toolbar";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { useMapOctomapEdits } from "@/hooks/use-map-octomap-edits";
import { useSaveMapOctomapEdits } from "@/hooks/use-map-actions";
import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { useMapEntry } from "@/hooks/use-maps";
import { ZOOM_STEP_FACTOR } from "@/lib/map/gesture";
import {
  DEFAULT_BRUSH_RADIUS_M,
  LOCAL_FLOOR_RING_M,
  applyGroundPatch,
  cellsFor,
  clearanceCells,
  createGroundSession,
  fromFillKeys,
  fullBand,
  kzToMetres,
  metresToKz,
  sameEdits,
  setGroundBand,
  toFillKeys,
  groundPatchBytes,
  type GroundEdits,
  type GroundPatch,
} from "@/lib/map/ground-fill";
import { createUndoStack, popRedo, popUndo, pushPatch } from "@/lib/map/patch";
import { gridToWorld } from "@/lib/map/view";
import { isTypingTarget } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import type { OccupiedVoxels } from "@/lib/types/octree";

/**
 * The ground editor: the 3D map from above, and a brush that paints floor
 * into the holes the lidar never saw. A save records the patches on the
 * robot; the robot's own tool writes them into the tree, so the note after
 * a save says they wait to be applied.
 *
 * Loads the tree (shared with the dashboard's layer) and the saved patches,
 * and mounts the surface only once both are in: a record arriving after
 * strokes began would have to be merged.
 */
export function GroundEditor({
  name,
  onDirtyChange,
}: {
  name: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const entry = useMapEntry(name);
  const tree = useMapOctomap(name);
  const edits = useMapOctomapEdits(name);

  if (entry && entry.octomap_status !== "ok") {
    return (
      <Guard title="Cannot edit the ground">
        {entry.octomap_status === "converting"
          ? "The robot is still building this map's 3D map. Come back once it has finished."
          : entry.octomap_status === "failed"
            ? (entry.octomap_error ?? "The robot could not build this map's 3D map.")
            : "This map has no 3D map to edit. The robot builds one with the floor plan when it is set up to."}
      </Guard>
    );
  }
  if (tree.status === "error") {
    return <Guard title="Cannot edit the ground">{tree.error}</Guard>;
  }
  if (edits.status === "error") {
    // Painting over an unread record would erase it on the first Save.
    return (
      <Guard title="Cannot edit the ground">
        {edits.error ?? "The saved patches could not be read."}
      </Guard>
    );
  }
  if (!tree.voxels || edits.fillKey === null) {
    return (
      <p className="instrument-label flex h-full items-center justify-center text-muted-foreground">
        Loading {name}…
      </p>
    );
  }

  return (
    <GroundSurface
      key={`${name}/${entry?.octomap_version ?? ""}`}
      name={name}
      voxels={tree.voxels}
      initialFillKey={edits.fillKey}
      onDirtyChange={onDirtyChange}
    />
  );
}

function Guard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-md border border-hairline bg-panel p-4">
        <p className="instrument-label text-muted-foreground">{title}</p>
        <p className="mt-2 text-sm">{children}</p>
      </div>
    </div>
  );
}

type SaveNote =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string };

/**
 * The editor shell: tool state, the undo stack, shortcuts and the save flow.
 * The canvas owns the raster and the view; they meet at the session
 * (lib/map/ground-fill.ts), which is mutable and never in React state.
 */
function GroundSurface({
  name,
  voxels,
  initialFillKey,
  onDirtyChange,
}: {
  name: string;
  voxels: OccupiedVoxels;
  initialFillKey: number[][];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [session] = React.useState(() => {
    const { edits } = fromFillKeys(initialFillKey, voxels);
    return createGroundSession(voxels, edits);
  });
  /** Patches in the record that lie outside this tree: another save's. */
  const skipped = React.useMemo(
    () => fromFillKeys(initialFillKey, voxels).skipped,
    [initialFillKey, voxels],
  );

  const [tool, setTool] = React.useState<GroundTool>("pan");
  const [radiusM, setRadiusM] = React.useState<number>(DEFAULT_BRUSH_RADIUS_M);
  const [band, setBand] = React.useState(() => fullBand(voxels));
  const [spacePan, setSpacePan] = React.useState(false);
  const [fitNonce, setFitNonce] = React.useState(0);
  const [rasterNonce, setRasterNonce] = React.useState(0);
  const [zoomStep, setZoomStep] = React.useState<{ factor: number } | null>(null);
  const [hover, setHover] = React.useState<GroundHover | null>(null);
  const [scale, setScale] = React.useState(1);
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);
  const [count, setCount] = React.useState(session.edits.size);
  const [dirty, setDirty] = React.useState(false);
  const [note, setNote] = React.useState<SaveNote>({ kind: "idle" });
  /** The patches as last saved, compared against the session's for `dirty`. */
  const savedRef = React.useRef<GroundEdits>(new Map(session.edits));
  const historyRef = React.useRef(createUndoStack<GroundPatch>(groundPatchBytes));

  const runLock = useMapRunLock(name);
  const { mutate: save } = useSaveMapOctomapEdits();

  const res = voxels.res;
  const radius = cellsFor(radiusM, res);
  const ring = cellsFor(LOCAL_FLOOR_RING_M, res);
  const clearance = clearanceCells(res);

  const refresh = React.useCallback(() => {
    setCount(session.edits.size);
    setDirty(!sameEdits(session.edits, savedRef.current));
    setNote({ kind: "idle" });
  }, [session]);

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const commit = React.useCallback(
    (patch: GroundPatch) => {
      pushPatch(historyRef.current, patch);
      setCanUndo(true);
      setCanRedo(false);
      refresh();
    },
    [refresh],
  );

  const step = React.useCallback(
    (direction: "undo" | "redo") => {
      const stack = historyRef.current;
      const patch = direction === "undo" ? popUndo(stack) : popRedo(stack);
      if (!patch) return;
      setCanUndo(stack.undo.length > 0);
      setCanRedo(stack.redo.length > 0);
      applyGroundPatch(session.edits, patch, direction === "undo" ? "before" : "after");
      setRasterNonce((n) => n + 1);
      refresh();
    },
    [session, refresh],
  );
  const undo = React.useCallback(() => step("undo"), [step]);
  const redo = React.useCallback(() => step("redo"), [step]);
  const fit = React.useCallback(() => setFitNonce((n) => n + 1), []);
  const zoomIn = React.useCallback(() => setZoomStep({ factor: ZOOM_STEP_FACTOR }), []);
  const zoomOut = React.useCallback(() => setZoomStep({ factor: 1 / ZOOM_STEP_FACTOR }), []);

  /** Move the height band; the floors are rebuilt and every column repainted. */
  const changeBand = React.useCallback(
    (next: { lo: number; hi: number }) => {
      const lo = Math.min(next.lo, next.hi);
      const hi = Math.max(next.lo, next.hi);
      setBand({ lo, hi });
      setGroundBand(session, { lo, hi });
      setRasterNonce((n) => n + 1);
    },
    [session],
  );

  const onSave = React.useCallback(() => {
    if (runLock.locked || note.kind === "saving") return;
    const sent = new Map(session.edits);
    setNote({ kind: "saving" });
    save(
      { name, fillKey: toFillKeys(sent, voxels) },
      {
        onSuccess: (result) => {
          savedRef.current = sent;
          setDirty(!sameEdits(session.edits, sent));
          setNote({ kind: "saved", message: result.message });
        },
        onError: (cause) => setNote({ kind: "failed", message: cause.message }),
      },
    );
  }, [runLock.locked, note.kind, session, save, name, voxels]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setTool("pan");
        return;
      }
      if (isTypingTarget(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        setSpacePan(true);
        return;
      }
      if (mod) return;
      if (event.key === "0") {
        event.preventDefault();
        fit();
      } else if (event.key.toLowerCase() === "b") {
        setTool("fill");
      } else if (event.key.toLowerCase() === "e") {
        setTool("erase");
      } else if (event.key.toLowerCase() === "p") {
        setTool("pan");
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePan(false);
    };
    const onBlur = () => setSpacePan(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [undo, redo, fit]);

  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const world = hover ? gridToWorld(hover.col + 0.5, hover.row + 0.5, session.meta) : null;
  const floorM = hover?.floor != null ? kzToMetres(hover.floor, voxels) : null;
  const bandLoM = kzToMetres(band.lo, voxels);
  const bandHiM = kzToMetres(band.hi, voxels);
  const full = fullBand(voxels);
  const minM = kzToMetres(full.lo, voxels);
  const maxM = kzToMetres(full.hi, voxels);

  return (
    <div className="relative h-full w-full">
      <GroundCanvas
        session={session}
        tool={tool}
        radius={radius}
        ring={ring}
        clearance={clearance}
        spacePan={spacePan}
        fitNonce={fitNonce}
        zoomStep={zoomStep}
        rasterNonce={rasterNonce}
        onStrokeCommit={commit}
        onHover={setHover}
        onScaleChange={setScale}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 flex max-h-[calc(100%-1.5rem)] flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <GroundToolBar
            className="pointer-events-auto"
            onFit={fit}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            dirty={dirty}
            saving={note.kind === "saving"}
            writeLock={runLock.reason}
            onSave={onSave}
            tool={tool}
            onToolChange={setTool}
            radius={radiusM}
            onRadiusChange={setRadiusM}
          />
        </div>

        {/* Narrower on a phone so the map's middle stays reachable beside it;
          * the long hint is desktop-only, since a finger has no room for prose. */}
        <div className="pointer-events-none flex min-h-0 w-44 flex-col gap-2 overflow-y-auto sm:w-60">
          <div className={cn(overlayPanel, "pointer-events-auto space-y-1.5 p-2.5")}>
            <Readout label="Cell" value={hover ? `${hover.col}, ${hover.row}` : "—"} />
            <Readout
              label="Map"
              value={world ? `${world.wx.toFixed(2)}, ${world.wy.toFixed(2)}` : "—"}
              unit={world ? "m" : undefined}
            />
            <Readout
              label="Ground here"
              value={
                !hover
                  ? "—"
                  : floorM === null
                    ? "No ground nearby"
                    : floorM.toFixed(2)
              }
              unit={floorM !== null && hover ? "m" : undefined}
              tone={hover && floorM === null ? "caution" : "neutral"}
            />
            <Readout
              label="Patched"
              value={`${count} cell${count === 1 ? "" : "s"} · ${(count * res * res).toFixed(2)} m²`}
            />
            {/* data-zoom: what the phone test reads a pinch off. */}
            <Readout
              label="Zoom"
              value={<span data-zoom={Math.round(scale * 100)}>{Math.round(scale * 100)}</span>}
              unit="%"
            />
          </div>

          <div className={cn(overlayPanel, "pointer-events-auto space-y-2 p-2.5")}>
            <p className="instrument-label text-muted-foreground">Heights shown</p>
            <label className="block text-[11px] leading-snug">
              <span className="flex justify-between text-muted-foreground">
                <span>Lowest</span>
                <span className="readout">{bandLoM.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                aria-label="Lowest height shown"
                className="w-full accent-signal-cmd"
                min={minM}
                max={maxM}
                step={res}
                value={bandLoM}
                onChange={(event) =>
                  changeBand({ lo: metresToKz(Number(event.target.value), voxels), hi: band.hi })
                }
              />
            </label>
            <label className="block text-[11px] leading-snug">
              <span className="flex justify-between text-muted-foreground">
                <span>Highest</span>
                <span className="readout">{bandHiM.toFixed(1)} m</span>
              </span>
              <input
                type="range"
                aria-label="Highest height shown"
                className="w-full accent-signal-cmd"
                min={minM}
                max={maxM}
                step={res}
                value={bandHiM}
                onChange={(event) =>
                  changeBand({ lo: band.lo, hi: metresToKz(Number(event.target.value), voxels) })
                }
              />
            </label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              On a map with more than one storey, narrow this to the floor you are patching: the
              brush reads the lowest cell shown in each column as its floor.
            </p>
          </div>

          {skipped > 0 && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-caution",
              )}
            >
              {skipped} saved patch{skipped === 1 ? " lies" : "es lie"} outside this 3D map and
              {skipped === 1 ? " is" : " are"} not shown; saving will drop {skipped === 1 ? "it" : "them"}.
            </p>
          )}

          {runLock.reason && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-caution",
              )}
            >
              Read-only. {runLock.reason}
            </p>
          )}

          {note.kind === "saved" && (
            <p
              role="status"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug text-signal-live",
              )}
            >
              {note.message}
            </p>
          )}
          {note.kind === "failed" && (
            <p
              role="alert"
              className={cn(
                overlayPanel,
                "pointer-events-auto px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
              )}
            >
              Not saved. {note.message}
            </p>
          )}

          <p
            className={cn(
              overlayPanel,
              "pointer-events-auto hidden px-2 py-1.5 text-[11px] leading-snug text-muted-foreground sm:block",
            )}
          >
            Fill paints floor into the holes under the brush, at the height of the floor within
            1 m of it; a column with anything in the 0.6 m above that height is left alone.
            <span className="mt-1 block text-signal-caution">
              Patch only where you know there is floor the robot never saw. A stairwell, a
              floor opening or a platform edge patched over will be walked into.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
