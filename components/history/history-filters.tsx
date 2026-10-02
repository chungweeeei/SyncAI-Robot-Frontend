"use client";

import * as React from "react";

import { Segmented } from "@/components/console/instrument";
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
  HISTORY_KINDS,
  TIME_RANGE_PRESETS,
  customRangeSeed,
  isoToLocalInput,
  kindLabel,
  localInputToIso,
  type HistoryFilter,
  type HistoryStatusFilter,
  type TimeRangePreset,
} from "@/lib/task/history";

type RangeChoice = TimeRangePreset | "custom";

const RANGE_OPTIONS: readonly { value: RangeChoice; label: string }[] = [
  ...TIME_RANGE_PRESETS.map(({ value, label }) => ({ value, label })),
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS: readonly { value: HistoryStatusFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELED", label: "Canceled" },
];

/**
 * The Select's value for "no narrowing": an empty string, which no kind and no
 * template name can be. The primitive treats "" as nothing selected and shows
 * the placeholder, so each picker's placeholder is that choice's own label.
 */
const ANY = "";

const KIND_ITEMS: readonly { value: string; label: string }[] = [
  { value: ANY, label: "All kinds" },
  ...HISTORY_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) })),
];

export interface HistoryFiltersProps {
  filter: HistoryFilter;
  onChange: (next: HistoryFilter) => void;
  /** Template names to offer; empty while nothing on the robot has one. */
  names: readonly string[];
  /** The zone a custom range is typed in, or "" before the browser has said. */
  timeZone: string;
}

/**
 * The one row that scopes everything under it: the counts and the list read
 * the same filter, so the numbers are always about the rows.
 *
 * Window first, because it is the control every reader reaches for; then the
 * outcome, which was the screen's only filter before; then kind and name as
 * pickers rather than more segments, because four segments twice already fill
 * a phone's row. Picking Custom seeds the two bounds from the window that was
 * on screen, so the inputs are never blank; a bound that is not yet a time
 * leaves the filter alone, so a half-typed field never reaches the backend.
 */
export function HistoryFilters({ filter, onChange, names, timeZone }: HistoryFiltersProps) {
  const kindId = React.useId();
  const nameId = React.useId();
  const fromId = React.useId();
  const toId = React.useId();

  // Narrowed once: null while a preset is picked, the two bounds otherwise.
  const custom = "preset" in filter.range ? null : filter.range;
  const rangeValue: RangeChoice = "preset" in filter.range ? filter.range.preset : "custom";

  const pickRange = (choice: RangeChoice) => {
    if (choice === "custom") {
      if (custom) return;
      onChange({ ...filter, range: customRangeSeed(filter.range, Date.now()) });
    } else {
      onChange({ ...filter, range: { preset: choice } });
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
    <div
      role="group"
      aria-label="History filters"
      className="flex flex-wrap items-end gap-x-4 gap-y-2"
    >
      <Segmented
        label="Time range"
        value={rangeValue}
        options={RANGE_OPTIONS}
        onChange={pickRange}
      />

      {custom && (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={fromId} className="flex flex-col gap-1">
            <span className="instrument-label text-muted-foreground">From</span>
            <Input
              id={fromId}
              type="datetime-local"
              value={isoToLocalInput(custom.from)}
              max={isoToLocalInput(custom.to)}
              onChange={(event) => setBound("from", event.target.value)}
              className="h-6 w-auto rounded-sm text-[12px] md:text-[12px]"
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
              className="h-6 w-auto rounded-sm text-[12px] md:text-[12px]"
            />
          </label>
          {/* Which clock the two fields are in: the operator's, which the
            * server render cannot know, so the caption only appears once the
            * browser has said. */}
          {timeZone && (
            <span className="pb-1 text-[11px] leading-tight text-muted-foreground">
              {timeZone}
            </span>
          )}
        </div>
      )}

      <Segmented
        label="Outcome"
        value={filter.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onChange({ ...filter, status })}
      />

      <div className="flex items-center gap-1.5">
        <label htmlFor={kindId} className="instrument-label text-muted-foreground">
          Kind
        </label>
        <Select
          items={KIND_ITEMS}
          value={filter.kind ?? ANY}
          onValueChange={(next) =>
            onChange({ ...filter, kind: next ? (next as TaskHistoryKind) : null })
          }
        >
          <SelectTrigger id={kindId} size="sm" className="h-6 min-w-32 rounded-sm text-[12px]">
            <SelectValue placeholder="All kinds" />
          </SelectTrigger>
          <SelectContent>
            {KIND_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1.5">
        <label htmlFor={nameId} className="instrument-label text-muted-foreground">
          Name
        </label>
        <Select
          items={nameItems}
          value={filter.name ?? ANY}
          disabled={!names.length}
          onValueChange={(next) => onChange({ ...filter, name: next ? next : null })}
        >
          <SelectTrigger id={nameId} size="sm" className="h-6 min-w-36 rounded-sm text-[12px]">
            <SelectValue placeholder={names.length ? "All names" : "No saved jobs"} />
          </SelectTrigger>
          <SelectContent>
            {nameItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
