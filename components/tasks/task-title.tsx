"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { TASK_TEMPLATE_NAME_MAX, taskTemplateNameOk } from "@/lib/task/template";

export interface TaskTitleProps {
  /** The name as typed, which is the draft's. */
  value: string;
  /** The loaded template's saved name, or null for a job not saved yet. */
  savedName: string | null;
  busy: boolean;
  /** Set when Save was pressed without a usable name; cleared by typing. */
  missing: boolean;
  /** Names already in the library, for the duplicate hint. */
  existingNames: readonly string[];
  onChange: (name: string) => void;
  /** Escape: back to the saved name, with nothing sent. */
  onRevert: () => void;
  /** Enter: the same Save as the header's button. */
  onSubmit: () => void;
  ref?: React.Ref<HTMLInputElement>;
}

/**
 * The editor's heading and the one place a job is named: an always-open input.
 * The name is part of the draft and is written by the same Save as the steps,
 * so the page has one moment that writes.
 *
 * Enter saves; Escape restores the saved name. A screen reader's heading sits
 * beside the field, out of sight.
 */
export function TaskTitle({
  value,
  savedName,
  busy,
  missing,
  existingNames,
  onChange,
  onRevert,
  onSubmit,
  ref,
}: TaskTitleProps) {
  const hintId = React.useId();
  const trimmed = value.trim();
  // A warning, not a gate: duplicates are allowed, the id is the identity.
  const duplicate =
    taskTemplateNameOk(value) &&
    trimmed !== savedName?.trim() &&
    existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());

  return (
    <form
      className="min-w-0 space-y-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
    >
      {/* The saved name, not the typed one, so it does not move per keystroke. */}
      <h1 className="sr-only">{savedName ?? "New task"}</h1>
      <Input
        ref={ref}
        value={value}
        // Read-only, not disabled, during a save: disabling drops the focus.
        readOnly={busy}
        maxLength={TASK_TEMPLATE_NAME_MAX}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onRevert();
          }
        }}
        aria-label="Task name"
        aria-invalid={missing || undefined}
        aria-describedby={missing || duplicate ? hintId : undefined}
        placeholder="Name this task"
        className="h-9 -ml-2.5 border-transparent bg-transparent text-xl font-semibold tracking-tight hover:border-input md:text-xl dark:bg-transparent"
      />
      {missing ? (
        <p id={hintId} className="text-[11px] leading-tight text-signal-warn">
          Name this task to save it.
        </p>
      ) : (
        duplicate && (
          <p id={hintId} className="text-[11px] leading-tight text-signal-caution">
            Another task already has this name. That is allowed — the two are told
            apart by id, not by name.
          </p>
        )
      )}
    </form>
  );
}
