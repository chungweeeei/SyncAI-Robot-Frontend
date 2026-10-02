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
  type TimeRangePreset,
} from "@/lib/task/history";

type TimeChoice = TimeRangePreset | "custom";

const TIME_ITEMS: readonly { value: TimeChoice; label: string }[] = [
  ...TIME_RANGE_PRESETS.map(({ value, label }) => ({ value, label })),
  { value: "custom", label: "Custom range…" },
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

/** One labelled picker of the toolbar; the three read the same so the row reads as one control. */
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
        // `items` is what makes SelectValue render the label; without it the
        // trigger shows the raw value.
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
 * The toolbar that scopes everything under it: the counts and the list read
 * the same window, kind and name, so the numbers are always about the rows.
 *
 * Three pickers of one shape, window first because it is the control every
 * reader reaches for, and a Reset that only appears once something is
 * narrowed — so a plain screen has nothing to clear and says so by having no
 * button. The outcome is not here: it is picked on the dashboard's tiles,
 * where the number for each outcome already is.
 *
 * A custom range gets its own line under the toolbar rather than a slot in
 * it: two date fields are wider than any picker, and in the row they pushed
 * the other controls onto a second line on every desktop and a fifth on a
 * phone. Picking it seeds the bounds from the window that was on screen, so
 * the fields are never blank; a bound that is not yet a time leaves the
 * filter alone, so a half-typed field never reaches the backend.
 */
export function HistoryFilters({ filter, onChange, names, timeZone }: HistoryFiltersProps) {
  const fromId = React.useId();
  const toId = React.useId();

  // Narrowed once: null while a preset is picked, the two bounds otherwise.
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
          {/* Which clock the two fields are in: the operator's, which the
            * server render cannot know, so the caption only appears once the
            * browser has said. */}
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
