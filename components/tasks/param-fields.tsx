"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StepParamField, StepSpec } from "@/lib/task/catalogue";
import type { StepDraft } from "@/lib/task/step";
import { cn } from "@/lib/utils";

/**
 * The draft holds each field as typed, under the field's own key — today's
 * keys (`text`, `repeat`, `seconds`) are the wire's, so the draft and the
 * catalogue meet without a table. A key the draft does not hold as text is a
 * field this console cannot keep, and is not drawn.
 */
function draftValue(step: StepDraft, key: string): string | null {
  const value = (step as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * An action's settings in its row, drawn from the catalogue's fields rather
 * than written per type. The waypoint kind is the stop card's; it is never
 * an action's field.
 */
export function ParamFields({
  spec,
  step,
  context,
  disabled,
  onChange,
}: {
  spec: StepSpec;
  step: StepDraft;
  /** Appended to each field's accessible name, so two Speak rows are told apart. */
  context: string;
  disabled: boolean;
  /** One field's new text; the caller tags it for Undo by `${step.key}:${key}`. */
  onChange: (key: string, value: string) => void;
}) {
  const fields = spec.params.filter((field) => field.kind !== "waypoint");
  if (!fields.length) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      {fields.map((field) => {
        const value = draftValue(step, field.key);
        if (value === null) return null;
        return (
          <ParamField
            key={field.key}
            field={field}
            value={value}
            label={`${field.label}, ${context}`}
            disabled={disabled}
            onChange={(next) => onChange(field.key, next)}
          />
        );
      })}
    </div>
  );
}

function ParamField({
  field,
  value,
  label,
  disabled,
  onChange,
}: {
  field: Exclude<StepParamField, { kind: "waypoint" }>;
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const unitId = React.useId();

  // Demo branch only (DEMO's result). "" is no pick yet: the row error asks for one.
  if (field.kind === "choice") {
    return (
      <Select
        items={field.options}
        value={value || null}
        onValueChange={(next) => {
          if (next !== null) onChange(next as string);
        }}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label} size="sm" className="h-7 min-w-36 rounded-sm">
          <SelectValue placeholder={field.label} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {field.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.kind === "text") {
    const length = value.trim().length;
    return (
      <span className="flex min-w-40 flex-1 items-center gap-1.5">
        <Input
          value={value}
          disabled={disabled}
          // No maxLength: it would silently truncate a paste; the row error
          // says how far over the text is instead.
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder ?? undefined}
          aria-label={label}
          // No size below md: iOS Safari zooms into any field under 16 px.
          className="h-7 min-w-0 flex-1 rounded-sm md:text-[13px]"
        />
        {/* The counter appears only near the limit. */}
        {value.length > field.max_length - 100 && (
          <span
            className={cn(
              "readout shrink-0 text-[11px]",
              length > field.max_length ? "text-signal-warn" : "text-signal-caution",
            )}
          >
            {value.length} / {field.max_length}
          </span>
        )}
      </span>
    );
  }

  // The name before a number, where a unit alone would read "1 times".
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="instrument-label text-muted-foreground" aria-hidden>
        {field.label}
      </span>
      <Input
        value={value}
        disabled={disabled}
        // Not type="number": it reports "" for "1." and "-", erasing what is
        // halfway typed.
        inputMode={field.kind === "integer" ? "numeric" : "decimal"}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.kind === "number" ? (field.placeholder ?? undefined) : String(field.default)}
        aria-label={label}
        aria-describedby={field.unit ? unitId : undefined}
        className="h-7 w-16 rounded-sm md:text-[13px]"
      />
      {field.unit && (
        <span id={unitId} className="text-[11px] text-muted-foreground">
          {field.unit}
        </span>
      )}
    </span>
  );
}
