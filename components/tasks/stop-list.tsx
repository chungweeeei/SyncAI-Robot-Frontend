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
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisIcon,
  GripVerticalIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { TaskStatusChip } from "@/components/console/task-chip";
import { ActionSection, type EditSteps } from "@/components/tasks/action-section";
import { IconButton } from "@/components/tasks/icon-button";
import { WaypointCombobox } from "@/components/tasks/waypoint-combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import type { TaskStepState } from "@/lib/api/task";
import type { WaypointEditor } from "@/lib/map/links";
import {
  actionSpecs,
  stepSpec,
  stopSpecs,
  transitSpecs,
  type StepCatalogue,
  type StepSpec,
} from "@/lib/task/catalogue";
import {
  newStepDraft,
  stepDraftError,
  stepIdFor,
  stepPatchFromVertex,
  type StepDraft,
} from "@/lib/task/step";
import {
  addAction,
  insertStop,
  moveStop,
  removeStop,
  sectionRange,
  stopLayout,
  stopOfRow,
  type StopBlock,
  type StopSection,
} from "@/lib/task/stops";
import type { MapFloor, MapVertex } from "@/lib/types/map";
import { cn } from "@/lib/utils";

export interface StopListProps {
  steps: StepDraft[];
  catalogue: StepCatalogue;
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  waypointLink: WaypointEditor | null;
  floors: readonly MapFloor[];
  /** Vertex id → the stops that go there; see stopWaypointOrdinals. */
  stopMarks: ReadonlyMap<string, readonly number[]>;
  /** True while the job's run is followed: the ids are positional. */
  disabled: boolean;
  stepStates: ReadonlyMap<string, TaskStepState>;
  refusal: { key: number; message: string } | null;
  /** A row's key, or "start"; the map's next tap adds a stop after its stop. */
  selected: number | "start" | null;
  onSelect: (selected: number | "start" | null) => void;
  /** The waypoint under the map's pointer, which lights its cards. */
  hoveredVertex: string | null;
  /** The row of the stop card under the pointer, whose waypoint and leg the map lights. */
  onHoverStop: (key: number | null) => void;
  edit: EditSteps;
}

/**
 * The job as the route it is: what is done before setting off, then a card
 * per stop with what is done on the way there and on arrival.
 *
 * Stops drag as whole cards, their actions with them; actions drag within
 * their own run (see ActionSection). Removing a stop takes its actions
 * without asking, since Undo brings them back.
 */
export function StopList({
  steps,
  catalogue,
  vertices,
  verticesStatus,
  mapName,
  waypointLink,
  floors,
  stopMarks,
  disabled,
  stepStates,
  refusal,
  selected,
  onSelect,
  hoveredVertex,
  onHoverStop,
  edit,
}: StopListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const layout = stopLayout(steps);
  const stopKeys = layout.stops.map((stop) => stop.key);
  const position = (id: UniqueIdentifier) => stopKeys.indexOf(Number(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up stop ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `Stop ${position(active.id)} is over position ${position(over.id)} of ${stopKeys.length}.`
        : `Stop ${position(active.id)} is no longer over the list.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Stop ${position(active.id)} moved to position ${position(over.id)} of ${stopKeys.length}.`
        : `Stop ${position(active.id)} dropped back in place.`,
    onDragCancel: ({ active }) => `Reorder cancelled. Stop ${position(active.id)} is back in place.`,
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    edit((current) => moveStop(current, Number(active.id), stopKeys.indexOf(Number(over.id))));
  };

  /** A new stop without a waypoint yet, where the map's next tap would put one. */
  const addStop = (spec: StepSpec) => {
    const row = newStepDraft(spec.type);
    const after = selected === "start" || selected === null ? selected : stopOfRow(steps, selected);
    edit((current) => insertStop(current, after, row));
    onSelect(row.key);
  };

  const shared = { steps, catalogue, disabled, stepStates, refusal, selected, edit };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "rounded-sm border px-2 py-1.5",
          selected === "start" ? "border-signal-cmd/60" : "border-hairline",
        )}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onSelect("start");
        }}
      >
        <ActionSection
          {...shared}
          section={{ kind: "start" }}
          label="Before setting off"
          context="before setting off"
          range={{ from: 0, to: layout.startEnd }}
          addSpecs={actionSpecs(catalogue)}
          onSelect={onSelect}
          emptyHint={layout.stops.length ? "Nothing — the robot sets off at once." : undefined}
        />
      </div>

      {layout.stops.length === 0 ? (
        <p className="px-1 py-2 text-[11px] leading-snug text-muted-foreground">
          No stops yet. Click waypoints on the map in the order to visit them, or add a stop
          below and pick its waypoint.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                "To reorder, press space to pick the stop up, use the arrow keys to move it, then press space again to drop it, or escape to cancel.",
            },
          }}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={stopKeys} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {layout.stops.map((block, at) => (
                <StopCard
                  key={block.key}
                  {...shared}
                  block={block}
                  ordinal={at + 1}
                  count={layout.stops.length}
                  vertices={vertices}
                  verticesStatus={verticesStatus}
                  mapName={mapName}
                  waypointLink={waypointLink}
                  floors={floors}
                  stopMarks={stopMarks}
                  onSelect={onSelect}
                  lit={
                    hoveredVertex !== null && steps[block.index]!.vertexId === hoveredVertex
                  }
                  onHoverStop={onHoverStop}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2">
        <span className="instrument-label mr-0.5 text-muted-foreground">Add stop</span>
        {stopSpecs(catalogue).map((spec) => (
          <button
            key={spec.type}
            type="button"
            disabled={disabled}
            title={spec.hint}
            aria-label={`Add a ${spec.label} stop`}
            onClick={() => addStop(spec)}
            className="instrument-label flex h-7 items-center gap-1 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:h-10"
          >
            <PlusIcon className="size-3" aria-hidden />
            {spec.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StopCard({
  block,
  ordinal,
  count,
  steps,
  catalogue,
  vertices,
  verticesStatus,
  mapName,
  waypointLink,
  floors,
  stopMarks,
  disabled,
  stepStates,
  refusal,
  selected,
  onSelect,
  lit,
  onHoverStop,
  edit,
}: {
  block: StopBlock;
  ordinal: number;
  count: number;
  steps: StepDraft[];
  catalogue: StepCatalogue;
  vertices: MapVertex[];
  verticesStatus: ActiveVerticesStatus;
  mapName: string | null;
  waypointLink: WaypointEditor | null;
  floors: readonly MapFloor[];
  stopMarks: ReadonlyMap<string, readonly number[]>;
  disabled: boolean;
  stepStates: ReadonlyMap<string, TaskStepState>;
  refusal: { key: number; message: string } | null;
  selected: number | "start" | null;
  onSelect: (selected: number | "start" | null) => void;
  lit: boolean;
  onHoverStop: (key: number | null) => void;
  edit: EditSteps;
}) {
  const stop = steps[block.index]!;
  const spec = stepSpec(catalogue, stop.type);
  const label = spec?.label ?? stop.type;
  const name = `stop ${ordinal}`;
  /** What the card's headings call the stop: its waypoint, once one is picked. */
  const place =
    (stop.vertexId !== null
      ? vertices.find((vertex) => vertex.id === stop.vertexId)?.name
      : undefined) ?? name;
  const other = stopSpecs(catalogue).filter((each) => each.type !== stop.type);
  const ownSelected = selected !== null && selected !== "start" && stopOfRow(steps, selected) === stop.key;
  const error =
    stepDraftError(stop) ?? (refusal?.key === stop.key ? refusal.message : null);
  const state = stepStates.get(stepIdFor(block.index, stop.type)) ?? null;
  const layout = stopLayout(steps);
  const walk = sectionRange(layout, { kind: "transit", stop: stop.key })!;
  const arrival = sectionRange(layout, { kind: "arrival", stop: stop.key })!;
  const charger = spec?.params.some(
    (field) => field.kind === "waypoint" && field.filter === "charger",
  );

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.key, disabled });

  const shared = { steps, catalogue, disabled, stepStates, refusal, selected, onSelect, edit };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10")}
      onMouseEnter={() => onHoverStop(stop.key)}
      onMouseLeave={() => onHoverStop(null)}
      data-stop={ordinal}
      data-row-key={stop.key}
    >
      <div
        className={cn(
          "rounded-md border bg-panel",
          stop.key === selected ? "border-signal-cmd" : ownSelected ? "border-signal-cmd/50" : "border-hairline",
          lit && "ring-2 ring-signal-cmd/40",
          error && "border-signal-warn/50",
          isDragging && "shadow-lg ring-1 ring-signal-cmd/40",
        )}
      >
        {/* The header selects the stop; a press in its actions selects the action. */}
        <div
          className="flex items-center gap-2 border-b border-hairline px-2 py-1.5"
          onPointerDown={() => onSelect(stop.key)}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${name}`}
            title="Drag to reorder"
            disabled={disabled}
            className={cn(
              "-ml-1 flex h-6 w-4 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:w-8",
              disabled ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
          >
            <GripVerticalIcon className="size-3.5" aria-hidden />
          </button>
          <span
            className="readout flex size-5 shrink-0 items-center justify-center rounded-full bg-signal-cmd/12 text-[11px] text-signal-cmd"
            aria-hidden
          >
            {ordinal}
          </span>
          <span className="instrument-label w-10 shrink-0" title={spec?.hint}>
            {label}
          </span>
          <div className="min-w-0 flex-1">
            <WaypointCombobox
              vertices={vertices}
              status={verticesStatus}
              mapName={mapName}
              waypointLink={waypointLink}
              floors={floors}
              stopMarks={stopMarks}
              chargersFirst={charger ?? false}
              value={stop.vertexId}
              disabled={disabled}
              onPick={(vertex) =>
                edit((current) =>
                  current.map((row) =>
                    row.key === stop.key ? { ...row, ...stepPatchFromVertex(vertex) } : row,
                  ),
                )
              }
              label={`Waypoint for ${name}`}
            />
          </div>
          {stop.vertexMissing && stop.vertexId !== null && (
            <Chip tone="caution" className="max-sm:hidden">
              waypoint deleted
            </Chip>
          )}
          {state && <TaskStatusChip status={state.status} />}
          <div className="flex shrink-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`More actions for ${name}`}
                title="More actions"
                disabled={disabled}
                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-30 pointer-coarse:size-10"
              >
                <EllipsisIcon className="size-3.5" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  disabled={ordinal === 1}
                  onClick={() => edit((current) => moveStop(current, stop.key, ordinal - 2))}
                >
                  <ArrowUpIcon aria-hidden />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={ordinal === count}
                  onClick={() => edit((current) => moveStop(current, stop.key, ordinal))}
                >
                  <ArrowDownIcon aria-hidden />
                  Move down
                </DropdownMenuItem>
                {other.length > 0 && <DropdownMenuSeparator />}
                {other.map((each) => (
                  <DropdownMenuItem
                    key={each.type}
                    onClick={() =>
                      edit((current) =>
                        current.map((row) => (row.key === stop.key ? { ...row, type: each.type } : row)),
                      )
                    }
                  >
                    <RepeatIcon aria-hidden />
                    Change to {each.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              label={`Remove ${name}`}
              disabled={disabled}
              onClick={() => {
                edit((current) => removeStop(current, stop.key));
                onSelect(null);
              }}
              className="text-signal-warn hover:bg-signal-warn/12"
            >
              <Trash2Icon className="size-3.5" aria-hidden />
            </IconButton>
          </div>
        </div>
        {(error || state?.message || state?.error_msg) && (
          <div className="space-y-0.5 px-2 pt-1">
            {error && (
              <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
                {error}
              </p>
            )}
            {state?.message && (
              <p className="text-[11px] leading-snug break-words text-muted-foreground">
                {state.message}
              </p>
            )}
            {state?.error_msg && (
              <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
                {state.error_msg}
              </p>
            )}
          </div>
        )}
        {/* In the order it happens: the walk here, then what is done on
          * arrival, each named for the waypoint so neither heading needs
          * explaining. A dashed rail is the walk, a dot the arrival. */}
        <div className="space-y-1.5 px-2 py-1.5">
          {walk.to > walk.from && (
            <div className="relative pl-4">
              <span
                aria-hidden
                className="absolute top-1.5 bottom-0 left-[5px] border-l-2 border-dashed border-signal-cmd/40"
              />
              <ActionSection
                {...shared}
                section={{ kind: "transit", stop: stop.key }}
                label={<PlaceLabel words="On the way to" place={place} />}
                context={`on the way to ${name}`}
                range={{ from: walk.from, to: walk.to }}
                addSpecs={transitSpecs(catalogue)}
                withAdd={false}
              />
            </div>
          )}
          {arrival.to > arrival.from && (
            <div className="relative pl-4">
              <span
                aria-hidden
                className="absolute top-2 left-[2px] size-2 rounded-full bg-signal-cmd"
              />
              <ActionSection
                {...shared}
                section={{ kind: "arrival", stop: stop.key }}
                label={<PlaceLabel words="At" place={place} />}
                context={`on arrival at ${name}`}
                range={{ from: arrival.from, to: arrival.to }}
                addSpecs={actionSpecs(catalogue)}
                withAdd={false}
              />
            </div>
          )}
          <StopAddMenu
            name={name}
            place={place}
            stopKey={stop.key}
            catalogue={catalogue}
            disabled={disabled}
            edit={edit}
            onSelect={onSelect}
          />
        </div>
      </div>
    </li>
  );
}

/** "At lobby": the words in the heading's face, the waypoint's name as it is spelled. */
function PlaceLabel({ words, place }: { words: string; place: string }) {
  return (
    <>
      {words}{" "}
      <span className="readout text-[12px] text-foreground normal-case">{place}</span>
    </>
  );
}

/**
 * One Add for the card, its menu in the order the stop happens: what is done
 * at the waypoint first, since that is most of what is added, then what is
 * done on the way there — only what leaves the body free, as the walk
 * already occupies it.
 */
function StopAddMenu({
  name,
  place,
  stopKey,
  catalogue,
  disabled,
  edit,
  onSelect,
}: {
  name: string;
  place: string;
  stopKey: number;
  catalogue: StepCatalogue;
  disabled: boolean;
  edit: EditSteps;
  onSelect: (selected: number | "start" | null) => void;
}) {
  const add = (section: StopSection, spec: StepSpec) => {
    // Minted here, not in the updater, so a twice-run updater cannot mint two.
    const row = newStepDraft(spec.type);
    edit((current) => addAction(current, section, row));
    onSelect(row.key);
  };
  const groups: { section: StopSection; label: string; specs: StepSpec[] }[] = [
    { section: { kind: "arrival", stop: stopKey }, label: `At ${place}`, specs: actionSpecs(catalogue) },
    {
      section: { kind: "transit", stop: stopKey },
      label: `On the way to ${place}`,
      specs: transitSpecs(catalogue),
    },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={`Add an action at ${name}`}
        className="instrument-label ml-4 flex h-6 items-center gap-1 rounded-sm border border-dashed border-hairline px-1.5 text-muted-foreground transition-colors hover:border-solid hover:bg-elevated hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:h-10"
      >
        <PlusIcon className="size-3" aria-hidden />
        Add action
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {groups.map((group, at) => (
          <React.Fragment key={group.section.kind}>
            {at > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate">{group.label}</DropdownMenuLabel>
              {group.specs.map((spec) => (
                <DropdownMenuItem key={spec.type} onClick={() => add(group.section, spec)}>
                  <span className="flex min-w-0 flex-col">
                    <span>{spec.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {spec.hint}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
