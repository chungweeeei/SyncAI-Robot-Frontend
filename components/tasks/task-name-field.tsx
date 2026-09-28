"use client";

import { Input } from "@/components/ui/input";
import { TASK_TEMPLATE_NAME_MAX, taskTemplateNameOk } from "@/lib/task/template";

export interface TaskNameFieldProps {
  /** The template currently loaded in the editor, or null when authoring fresh. */
  editing: { id: string; name: string } | null;
  /**
   * The name, as typed. Held by the task draft rather than here so a
   * half-named job survives a trip to the map editor.
   */
  name: string;
  onNameChange: (name: string) => void;
  /** Why Save is held, as a muted line. Null when nothing is in the way. */
  reason: string | null;
  busy: boolean;
  /** A refused write, rendered verbatim. */
  error: string | null;
  /** Names already in the library, for the duplicate hint. */
  existingNames: readonly string[];
  /** Enter in the field saves, the same as the header's Save. */
  onSubmit: () => void;
}

/**
 * The job's name, and why it cannot be saved yet.
 *
 * The button that saves is not here: it is in the editor's header beside Go
 * back, one Save that updates a loaded template and creates one otherwise.
 * There used to be two — Update and Save as new — so that "load A, tweak it,
 * save it as B" was an action in its own right. That is gone by request; a
 * copy is now made by saving under a new name from a fresh editor.
 *
 * What is left here is everything that explains the button's state, next to
 * the field the operator is looking at when it is greyed out.
 */
export function TaskNameField({
  editing,
  name,
  onNameChange,
  reason,
  busy,
  error,
  existingNames,
  onSubmit,
}: TaskNameFieldProps) {
  const trimmed = name.trim();
  const nameOk = taskTemplateNameOk(name);

  // A warning, not a gate: duplicate names are allowed by design (the id is the
  // identity, exactly as for map vertices), and there is no migration path to add
  // a unique constraint later even if that changed. Saying so beats refusing.
  const duplicate =
    nameOk &&
    trimmed !== editing?.name &&
    existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());

  const localReason = !nameOk && trimmed.length > 0 ? "That name is too long." : null;

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="block">
        <span className="instrument-label text-muted-foreground">Name</span>
        <Input
          value={name}
          disabled={busy}
          maxLength={TASK_TEMPLATE_NAME_MAX}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Morning patrol"
          className="readout mt-0.5 h-7 rounded-sm md:text-[13px]"
        />
      </label>

      {duplicate && (
        <p className="text-[11px] leading-tight text-signal-caution">
          Another template already has this name. Saving is still allowed — the
          two are told apart by id, not by name.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      {(localReason ?? reason) && (
        <p className="text-[11px] leading-tight text-muted-foreground">
          {localReason ?? reason}
        </p>
      )}
    </form>
  );
}
