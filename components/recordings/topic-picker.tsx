"use client";

import * as React from "react";

import type { TopicPreset } from "@/lib/recording/topics";
import { cn } from "@/lib/utils";

/**
 * One selectable channel; chosen ones take the commanded hue (a choice, not a
 * measurement).
 *
 * The label is the exact channel name, since that is what the recording's
 * metadata and playback will show; the plain-language half is the tooltip only.
 */
function TopicChip({
  topic,
  hint,
  selected,
  disabled,
  onToggle,
}: {
  topic: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border transition-colors",
        selected
          ? "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
          : "border-hairline text-muted-foreground",
        disabled && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        disabled={disabled}
        onClick={onToggle}
        title={hint}
        className={cn(
          "readout h-6 px-1.5 text-[11px] leading-none pointer-coarse:h-10 pointer-coarse:px-2.5",
          !disabled && !selected && "hover:bg-elevated hover:text-foreground",
        )}
      >
        {topic}
      </button>
    </span>
  );
}

/**
 * Pick the channels a recording subscribes to: toggles rather than free text,
 * because a misspelled channel records nothing silently. The list is the
 * robot model's, from lib/recording/topics.ts; a channel off it is added
 * there in code, by request.
 */
export function TopicPicker({
  presets,
  value,
  onChange,
  disabled = false,
}: {
  presets: readonly TopicPreset[];
  value: readonly string[];
  onChange: (topics: string[]) => void;
  disabled?: boolean;
}) {
  const selected = React.useMemo(() => new Set(value), [value]);

  const toggle = React.useCallback(
    (topic: string) => {
      onChange(
        selected.has(topic)
          ? value.filter((entry) => entry !== topic)
          : [...value, topic],
      );
    },
    [onChange, selected, value],
  );

  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <TopicChip
          key={preset.topic}
          topic={preset.topic}
          hint={preset.hint}
          selected={selected.has(preset.topic)}
          disabled={disabled}
          onToggle={() => toggle(preset.topic)}
        />
      ))}
    </div>
  );
}
