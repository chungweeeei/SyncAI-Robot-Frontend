"use client";

import * as React from "react";
import { CheckIcon, SettingsIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TASK_TEMPLATE_NAME_MAX, taskTemplateNameOk } from "@/lib/task/template";

export interface TaskTitleProps {
  /** What the heading reads while it is not being edited. */
  title: string;
  /** The name the field opens on. */
  name: string;
  /** Whether the heading is the input. The editor owns it, because Save opens it too. */
  naming: boolean;
  busy: boolean;
  /** Names already in the library, for the duplicate hint. */
  existingNames: readonly string[];
  onStartNaming: () => void;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

/**
 * The editor's heading, and the one place a job is named.
 *
 * Edited in place, the way a map card's title is: the settings button turns
 * the heading into an input of the same face, with confirm and cancel beside
 * it, Enter to confirm and Escape to back out. Not a modal, because every name
 * edit in this console is an inline form. What confirming *does* is the
 * editor's call — rename a saved job straight away, or name a new one — so it
 * is handed up rather than decided here.
 *
 * Remounted per opening (the editor keys it), which is what starts the field
 * from the current name rather than from whatever was typed and abandoned.
 */
export function TaskTitle({
  title,
  name,
  naming,
  busy,
  existingNames,
  onStartNaming,
  onCancel,
  onSubmit,
}: TaskTitleProps) {
  const [value, setValue] = React.useState(name);
  const settingsRef = React.useRef<HTMLButtonElement>(null);
  const wasNaming = React.useRef(naming);

  // Focus goes back to the button that opened the field, so a keyboard
  // operator is not dropped at the top of the page by a confirm or an Escape.
  React.useEffect(() => {
    if (wasNaming.current && !naming) settingsRef.current?.focus();
    wasNaming.current = naming;
  }, [naming]);

  if (!naming) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        <Button
          ref={settingsRef}
          variant="ghost"
          size="icon-sm"
          onClick={onStartNaming}
          aria-label="Rename task"
          title="Rename task"
          className="shrink-0 text-muted-foreground"
        >
          <SettingsIcon aria-hidden />
        </Button>
      </div>
    );
  }

  const trimmed = value.trim();
  const ok = taskTemplateNameOk(value);
  // A warning, not a gate: duplicate names are allowed by design (the id is the
  // identity, exactly as for map vertices). Saying so beats refusing.
  const duplicate =
    ok &&
    trimmed !== name.trim() &&
    existingNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase());

  return (
    <form
      className="min-w-0 space-y-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok && !busy) onSubmit(trimmed);
      }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          autoFocus
          value={value}
          disabled={busy}
          maxLength={TASK_TEMPLATE_NAME_MAX}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          aria-label="Task name"
          placeholder="Morning patrol"
          className="h-8 min-w-0 flex-1 text-xl font-semibold tracking-tight md:text-xl"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={!ok || busy}
          aria-label="Confirm name"
          title="Confirm name"
        >
          <CheckIcon aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCancel}
          aria-label="Cancel renaming"
          title="Cancel renaming"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      {duplicate && (
        <p className="text-[11px] leading-tight text-signal-caution">
          Another task already has this name. That is allowed — the two are told
          apart by id, not by name.
        </p>
      )}
    </form>
  );
}
