"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The channels offered as one tap, and why each is on the list.
 *
 * Hardcoded: the backend has no channel-list route, and one would put a ROS
 * graph query behind every visit. This can drift from what the robot
 * publishes, which is why each row shows its message count.
 *
 * Relative names only — the backend expands them (`livox/lidar` →
 * `/robot01/livox/lidar`). Trimmed to what rebuilding a map needs, by request.
 */
const PRESETS: readonly { topic: string; hint: string }[] = [
  // The pair a lost mapping run is replayed from — the reason this page exists.
  { topic: "livox/lidar", hint: "Laser scanner — the robot's main sensor" },
  { topic: "livox/imu", hint: "Motion sensor — needed with the scanner to rebuild a map" },
  { topic: "imu", hint: "Body motion sensor — how the robot itself tilts and turns" },
  // The camera node is pinned to MJPG, so only image_raw/compressed exists.
  // It is opt-in at bringup, so without it this records nothing — which the
  // zero-message row will say.
  { topic: "image_raw/compressed", hint: "Camera picture" },
  { topic: "odom", hint: "Where the robot calculates it has travelled" },
  { topic: "robot_state", hint: "Overall status: battery, mode, motor health" },
];

/**
 * The default: the LIO inputs (also the backend's default) plus the camera,
 * by request. The console always sends its list.
 */
export const DEFAULT_TOPICS = [
  "livox/lidar",
  "livox/imu",
  "image_raw/compressed",
];

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
 * Pick the channels a recording subscribes to: toggles rather than free text,
 * because a misspelled channel records nothing silently. A channel off this
 * list is added here in code, by request.
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
