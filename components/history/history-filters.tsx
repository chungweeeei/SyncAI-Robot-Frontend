"use client";

import * as React from "react";
import { RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaskHistoryKind } from "@/lib/api/task";
import {
  DEFAULT_HISTORY_FILTER,
  HISTORY_KINDS,
  TIME_RANGE_PRESETS,
  customRangeSeed,
  isDefaultHistoryFilter,
  isoToLocalInput,
  kindLabel,
  localInputToIso,
  type HistoryFilter,
  type HistoryStatusFilter,
  type TimeRangePreset,
} from "@/lib/task/history";

type TimeChoice = TimeRangePreset | "custom";

const TIME_ITEMS: readonly { value: TimeChoice; label: string }[] = [
  ...TIME_RANGE_PRESETS.map(({ value, label }) => ({ value, label })),
  { value: "custom", label: "Custom range…" },
];

/**
 * "No narrowing": "", which no kind or template name can be. The Select shows
 * its placeholder for "", so each placeholder is that choice's label.
 */
const ANY = "";

const KIND_ITEMS: readonly { value: string; label: string }[] = [
  { value: ANY, label: "All kinds" },
  ...HISTORY_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
];

const OUTCOME_ITEMS: readonly { value: HistoryStatusFilter; label: string }[] = [
  { value: "ALL", label: "All outcomes" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELED", label: "Canceled" },
];

/** One labelled picker; the four share a shape so the row reads as one control. */
function Picker({
  label,
  items,
  value,
  placeholder,
  disabled = false,
  onPick,
}: {
  label: string;
  items: readonly { value: string; label: string }[];
  value: string;
  placeholder: string;
  disabled?: boolean;
  onPick: (value: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="instrument-label text-muted-foreground">
        {label}
      </label>
      <Select
        // `items` makes SelectValue render the label, not the raw value.
        items={items}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onPick(next);
        }}
      >
        <SelectTrigger id={id} size="sm" className="h-7 min-w-32 rounded-sm text-[12px] pointer-coarse:h-10">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface HistoryFiltersProps {
  filter: HistoryFilter;
  onChange: (next: HistoryFilter) => void;
  /** Template names to offer; empty while nothing on the robot has one. */
  names: readonly string[];
  /** The zone a custom range is typed in, or "" before the browser has said. */
  timeZone: string;
}

/**
 * The toolbar that scopes everything under it: counts and list read the same
 * window, kind and name. The outcome scopes the list alone (see
 * toHistoryStatsQuery). Reset appears only once something is narrowed.
 *
 * A custom range gets its own line under the toolbar: two date fields pushed
 * the other pickers onto extra lines. Picking it seeds the bounds from the
 * window on screen, and a bound that isn't a time yet leaves the filter alone,
 * so a half-typed field never reaches the backend.
 */
export function HistoryFilters({ filter, onChange, names, timeZone }: HistoryFiltersProps) {
  const fromId = React.useId();
  const toId = React.useId();

  const custom = "preset" in filter.range ? null : filter.range;
  const timeValue: TimeChoice = "preset" in filter.range ? filter.range.preset : "custom";

  const pickTime = (choice: string) => {
    if (choice === "custom") {
      if (custom) return;
      onChange({ ...filter, range: customRangeSeed(filter.range, Date.now()) });
    } else {
      onChange({ ...filter, range: { preset: choice as TimeRangePreset } });
    }
  };

  const setBound = (bound: "from" | "to", value: string) => {
    if (!custom) return;
    const iso = localInputToIso(value);
    if (iso === null) return;
    const next = { ...custom, [bound]: iso };
    if (Date.parse(next.from) > Date.parse(next.to)) return;
    onChange({ ...filter, range: next });
  };

  const nameItems = [
    { value: ANY, label: "All names" },
    ...names.map((name) => ({ value: name, label: name })),
  ];

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="History filters"
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <Picker
          label="Time"
          items={TIME_ITEMS}
          value={timeValue}
          placeholder="Last 24 h"
          onPick={pickTime}
        />
        <Picker
          label="Outcome"
          items={OUTCOME_ITEMS}
          value={filter.status}
          placeholder="All outcomes"
          onPick={(next) => onChange({ ...filter, status: next as HistoryStatusFilter })}
        />
        <Picker
          label="Kind"
          items={KIND_ITEMS}
          value={filter.kind ?? ANY}
          placeholder="All kinds"
          onPick={(next) =>
            onChange({ ...filter, kind: next ? (next as TaskHistoryKind) : null })
          }
        />
        <Picker
          label="Name"
          items={nameItems}
          value={filter.name ?? ANY}
          placeholder={names.length ? "All names" : "No saved jobs"}
          disabled={!names.length}
          onPick={(next) => onChange({ ...filter, name: next ? next : null })}
        />

        {!isDefaultHistoryFilter(filter) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 rounded-sm pointer-coarse:h-10"
            onClick={() => onChange(DEFAULT_HISTORY_FILTER)}
          >
            <RotateCcwIcon aria-hidden />
            Reset
          </Button>
        )}
      </div>

      {custom && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-sm border border-hairline bg-panel px-3 py-2">
          <label htmlFor={fromId} className="flex flex-col gap-1">
            <span className="instrument-label text-muted-foreground">From</span>
            <Input
              id={fromId}
              type="datetime-local"
              value={isoToLocalInput(custom.from)}
              max={isoToLocalInput(custom.to)}
              onChange={(event) => setBound("from", event.target.value)}
              className="h-7 w-auto rounded-sm text-[12px] md:text-[12px] pointer-coarse:h-10"
            />
          </label>
          <label htmlFor={toId} className="flex flex-col gap-1">
            <span className="instrument-label text-muted-foreground">To</span>
            <Input
              id={toId}
              type="datetime-local"
              value={isoToLocalInput(custom.to)}
              min={isoToLocalInput(custom.from)}
              onChange={(event) => setBound("to", event.target.value)}
              className="h-7 w-auto rounded-sm text-[12px] md:text-[12px] pointer-coarse:h-10"
            />
          </label>
          {/* Which clock the fields are in; unknown to the server render, so
            * it appears once the browser has said. */}
          {timeZone && (
            <span className="pb-1.5 text-[11px] leading-tight text-muted-foreground">
              Times in {timeZone}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
