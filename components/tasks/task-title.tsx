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
 * The editor's heading, and the one place a job is named: an input that is
 * always open, in the heading's face.
 *
 * The name is part of the draft and goes to the robot with the steps, on the
 * one Save. It used to be a field behind a settings button with its own
 * confirm, and confirming renamed a saved job on the spot — so a new job took
 * a confirm before Save would take it, and a saved one had two moments that
 * wrote and two rules for what each wrote. One Save is the rule everything
 * else on this page already follows, so the name follows it too; what that
 * gives up is renaming without also saving step edits, which nobody missed
 * next to being able to just type.
 *
 * Enter saves, since a name is usually the last thing typed before saving;
 * Escape puts back the saved name. The visible heading is this field, so a
 * screen reader's heading is kept beside it, out of sight.
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
  // A warning, not a gate: duplicate names are allowed by design (the id is the
  // identity, exactly as for map vertices). Saying so beats refusing.
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
      {/* The job's own name, not "Editing …": being on this page already
        * says it is being edited. The saved name rather than the typed one, so
        * the heading does not move with every keystroke. */}
      <h1 className="sr-only">{savedName ?? "New task"}</h1>
      <Input
        ref={ref}
        value={value}
        // Read-only rather than disabled while a save is out: disabling drops
        // the focus, and Enter is how most saves from here are made.
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
