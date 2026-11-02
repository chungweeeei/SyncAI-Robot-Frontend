"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, XIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import type { EditSteps } from "@/components/tasks/action-section";
import { IconButton } from "@/components/tasks/icon-button";
import { WaypointCombobox } from "@/components/tasks/waypoint-combobox";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import type { WaypointEditor } from "@/lib/map/links";
import {
  addPatrolWaypoint,
  movePatrolWaypoint,
  patrolWaypointErrors,
  patrolWaypointFromVertex,
  removePatrolWaypoint,
  repickPatrolWaypoint,
  type PatrolWaypointDraft,
  type StepDraft,
} from "@/lib/task/step";
import type { MapFloor, MapVertex } from "@/lib/types/map";
import { cn } from "@/lib/utils";

export interface PatrolWaypointsProps {
  row: StepDraft;
  /** "stop 3": what the accessible names add, so two patrols are told apart. */
  name: string;
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  waypointLink: WaypointEditor | null;
  floors: readonly MapFloor[];
  stopMarks: ReadonlyMap<string, readonly number[]>;
  disabled: boolean;
  /** The patrol's card is selected, so a click on the map adds a waypoint here. */
  picking: boolean;
  edit: EditSteps;
}

/**
 * The grip (16 px, 32 under a finger), a 6 px gap and the 18 px mark: the
 * rail runs through the mark's centre, and the lines under a row start where
 * its waypoint box does.
 */
const RAIL = "left-[30px] pointer-coarse:left-[46px]";
const INDENT = "pl-[46px] pointer-coarse:pl-[62px]";

/** dnd-kit ids, apart from the stop list's numeric ones in the context around this. */
const dragId = (key: number) => `waypoint-${key}`;

/**
 * A Patrol's waypoints in the order it drives through them, drawn as the
 * stop card draws a walk: a dashed rail through rings the robot passes
 * without stopping, ending at a solid dot — the one waypoint it stops at,
 * facing that waypoint's own heading (the vertex's, as a Move's is; nothing
 * here to type, so the card says nothing about it). Dragged by their grips within the patrol, never out of it: a waypoint
 * moved to another stop would be a different job, which Remove and the
 * other stop's Add say more plainly.
 */
export function PatrolWaypoints({
  row,
  name,
  vertices,
  verticesStatus,
  mapName,
  waypointLink,
  floors,
  stopMarks,
  disabled,
  picking,
  edit,
}: PatrolWaypointsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const waypoints = row.waypoints;
  const ids = waypoints.map((waypoint) => dragId(waypoint.key));
  const errors = patrolWaypointErrors(row);
  const position = (id: UniqueIdentifier) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up waypoint ${position(active.id)} of ${name}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Waypoint ${position(active.id)} is over position ${position(over.id)} of ${ids.length}.`
        : `Waypoint ${position(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Waypoint ${position(active.id)} moved to position ${position(over.id)} of ${ids.length}.`
        : `Waypoint ${position(active.id)} dropped back in place.`,
    onDragCancel: ({ active }) =>
      `Reorder cancelled. Waypoint ${position(active.id)} is back in place.`,
  };

  /** Every change to this row's waypoints, through the editor's Undo. */
  const change = (next: (current: StepDraft) => StepDraft, tag: string | null = null) =>
    edit((current) => current.map((each) => (each.key === row.key ? next(each) : each)), tag);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    change((current) => movePatrolWaypoint(current, from, to));
  };

  const shared = { vertices, verticesStatus, mapName, waypointLink, floors, stopMarks, disabled };

  return (
    <div className="space-y-1">
      {waypoints.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To reorder, press space to pick the waypoint up, use the arrow keys to move it, then press space again to drop it, or escape to cancel.",
            },
          }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol aria-label={`Waypoints of ${name}, in the order driven`} className="space-y-0.5">
              {waypoints.map((waypoint, at) => (
                <PatrolWaypointRow
                  key={waypoint.key}
                  {...shared}
                  waypoint={waypoint}
                  ordinal={at + 1}
                  last={at === waypoints.length - 1}
                  name={name}
                  error={errors[at] ?? null}
                  onRepick={(vertex) =>
                    change((current) => repickPatrolWaypoint(current, waypoint.key, vertex))
                  }
                  onRemove={() =>
                    change((current) => removePatrolWaypoint(current, waypoint.key))
                  }
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      <div className={cn("flex min-w-0 items-center", INDENT)}>
        <div className="min-w-0 flex-1">
          <WaypointCombobox
            vertices={vertices}
            status={verticesStatus}
            mapName={mapName}
            waypointLink={waypointLink}
            floors={floors}
            stopMarks={stopMarks}
            disabled={disabled}
            chargersFirst={false}
            value={null}
            onPick={(vertex) => {
              // Minted here, not in the updater, so a twice-run updater cannot mint two.
              const added = patrolWaypointFromVertex(vertex);
              change((current) => addPatrolWaypoint(current, added));
            }}
            label={`Add a waypoint to ${name}`}
            emptyLabel={waypoints.length ? "Add the next waypoint" : "Add the first waypoint"}
          />
        </div>
      </div>
      {/* Said while it is true: a click on the map lands here only while this
        * card is the selection, and every other selection adds a stop. */}
      {picking && !disabled && (
        <p className={cn("text-[11px] leading-snug text-signal-cmd", INDENT)}>
          Clicks on the map add waypoints to this patrol, in order. Press Esc when done.
        </p>
      )}
    </div>
  );
}

function PatrolWaypointRow({
  waypoint,
  ordinal,
  last,
  name,
  error,
  vertices,
  verticesStatus,
  mapName,
  waypointLink,
  floors,
  stopMarks,
  disabled,
  onRepick,
  onRemove,
}: {
  waypoint: PatrolWaypointDraft;
  ordinal: number;
  last: boolean;
  name: string;
  error: string | null;
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  waypointLink: WaypointEditor | null;
  floors: readonly MapFloor[];
  stopMarks: ReadonlyMap<string, readonly number[]>;
  disabled: boolean;
  onRepick: (vertex: MapVertex) => void;
  onRemove: () => void;
}) {
  const errorId = React.useId();
  const label = `waypoint ${ordinal} of ${name}`;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: dragId(waypoint.key), disabled });
  // A point with no vertex reads as where it is, which is all it has.
  const freePoint =
    waypoint.vertexId === null && waypoint.x.trim() && waypoint.y.trim()
      ? `Free point (${waypoint.x}, ${waypoint.y})`
      : undefined;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative rounded-sm bg-panel", isDragging && "z-10 shadow-md ring-1 ring-signal-cmd/40")}
      data-waypoint={ordinal}
    >
      {/* The rail runs on to the next waypoint from every one but the last. */}
      {!last && (
        <span
          aria-hidden
          className={cn("absolute top-4 -bottom-1 border-l-2 border-dashed border-signal-cmd/40", RAIL)}
        />
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${label}`}
          title="Drag to reorder"
          disabled={disabled}
          className={cn(
            "flex h-6 w-4 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:w-8",
            disabled ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab",
          )}
        >
          <GripVerticalIcon className="size-3.5" aria-hidden />
        </button>
        {/* A ring is passed through, the dot is stopped at: the walk's and
          * the arrival's marks on the stop card, so the two read alike. */}
        <span
          aria-hidden
          className={cn(
            "relative z-[1] flex size-[18px] shrink-0 items-center justify-center rounded-full readout text-[10px]",
            last
              ? "bg-signal-cmd text-background"
              : "border-2 border-signal-cmd/60 bg-panel text-signal-cmd",
          )}
        >
          {ordinal}
        </span>
        <div className="min-w-0 flex-1">
          <WaypointCombobox
            vertices={vertices}
            status={verticesStatus}
            mapName={mapName}
            waypointLink={waypointLink}
            floors={floors}
            stopMarks={stopMarks}
            chargersFirst={false}
            value={waypoint.vertexId}
            disabled={disabled}
            onPick={onRepick}
            label={`Waypoint for ${label}`}
            emptyLabel={freePoint}
          />
        </div>
        {waypoint.vertexMissing && waypoint.vertexId !== null && (
          <Chip tone="caution" className="max-sm:hidden">
            waypoint deleted
          </Chip>
        )}
        <IconButton
          label={`Remove ${label}`}
          disabled={disabled}
          onClick={onRemove}
          className="hover:text-signal-warn"
        >
          <XIcon className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      <div className={cn("min-w-0 pb-1", INDENT)}>
        {error && (
          <p id={errorId} role="alert" className="text-[11px] leading-snug text-signal-warn">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
