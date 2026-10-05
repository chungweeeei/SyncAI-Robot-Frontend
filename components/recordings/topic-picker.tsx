"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The topics offered as one tap, and why each is on the list.
 *
 * Hardcoded rather than discovered: the backend has no topic-list route, and
 * adding one to serve a convenience row would put a ROS graph query behind
 * every visit to this page. The cost is that this list can drift from what the
 * robot actually publishes — which is why a recording's message count is on
 * every row of the catalogue.
 *
 * Relative names only. Everything the robot owns is namespaced and the backend
 * expands it (`livox/lidar` → `/robot01/livox/lidar`), so nothing here spells a
 * robot id.
 *
 * Kept to what is worth one tap. The drive commands, the live scan and the
 * two transform channels were offered too, and were trimmed by request; none
 * of them is needed to rebuild a map, which is what a recording is for.
 */
const PRESETS: readonly { topic: string; hint: string }[] = [
  // The pair a lost mapping run is replayed from — the reason this page exists.
  { topic: "livox/lidar", hint: "Laser scanner — the robot's main sensor" },
  { topic: "livox/imu", hint: "Motion sensor — needed with the scanner to rebuild a map" },
  { topic: "imu", hint: "Body motion sensor — how the robot itself tilts and turns" },
  { topic: "odom", hint: "Where the robot calculates it has travelled" },
  { topic: "robot_state", hint: "Overall status: battery, mode, motor health" },
];

/**
 * The default selection: the LIO inputs, which are the backend's own default,
 * plus the body IMU, by request. The console always sends its list, so the
 * backend's default only answers a client that sends none.
 */
export const DEFAULT_TOPICS = ["livox/lidar", "livox/imu", "imu"];

/**
 * One selectable topic. The `Segmented` idiom widened to multi-select: chosen
 * segments take the commanded hue because what is recorded is the operator's
 * choice, not a measurement.
 *
 * The label is the topic name itself, in the readout face. A friendlier word
 * ("Lidar") would read better and be the wrong trade: these exact strings are
 * what ends up in the bag's metadata and what `ros2 bag play` will name, so the
 * chip has to be verifiable against them. The plain-language half is the
 * tooltip, and only the tooltip: a "What these channels are" disclosure under
 * the row used to repeat it for touch screens, and was removed by request.
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
          "readout h-6 px-1.5 text-[11px] leading-none",
          !disabled && !selected && "hover:bg-elevated hover:text-foreground",
        )}
      >
        {topic}
      </button>
    </span>
  );
}

/**
 * Pick the topics a recording will subscribe to.
 *
 * Presets as toggles rather than the bare text field the hand-pasted
 * `ros2 bag record` command was: the common case here is one tap (the LIO
 * pair and the body IMU, already selected), and the failure mode of typing is
 * silent — a misspelled topic records nothing and says nothing, because the
 * recorder waits for topics rather than refusing unknown ones.
 *
 * There is no free-text row any more, by request: a channel off this list is
 * added here, in code, with its hint.
 */
export function TopicPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
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
      {PRESETS.map((preset) => (
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
