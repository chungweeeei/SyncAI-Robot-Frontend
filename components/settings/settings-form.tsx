"use client";

import * as React from "react";
import { RotateCcwIcon, SaveIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useSettings, useSettingsWrites } from "@/hooks/use-settings";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import type { SettingField, SettingsPageId } from "@/lib/api/settings";
import {
  draftOf,
  formatValue,
  formatWithUnit,
  summarizeDrafts,
  type SettingDrafts,
} from "@/lib/settings/form";
import { cn } from "@/lib/utils";

/**
 * One settings page (the controller's, the planner's), drawn from the robot's
 * own description of it: which settings, their words, their limits and how
 * each takes effect all come from the robot, so this form has no list of its
 * own to fall out of step with, and a new page is a route and a backend
 * schema, not a new form.
 *
 * Edits are drafts until Save, which sends only what differs from the
 * robot's value, all at once — the robot applies a change as a whole or not
 * at all, and the answer is the new state, so the drafts clear on it. A
 * refusal keeps them, with the robot's sentence, so a value can be fixed
 * rather than retyped.
 */
export function SettingsForm({ page }: { page: SettingsPageId }) {
  const query = useSettings(page);
  const { update, reset } = useSettingsWrites(page);
  const [drafts, setDrafts] = React.useState<SettingDrafts>({});
  const [confirmingReset, setConfirmingReset] = React.useState(false);

  const settings = query.data;
  const fields = React.useMemo(() => settings?.fields ?? [], [settings]);
  const { changes, invalid } = React.useMemo(
    () => summarizeDrafts(fields, drafts),
    [fields, drafts],
  );
  const changeCount = Object.keys(changes).length;
  const invalidCount = Object.keys(invalid).length;
  const busy = update.isPending || reset.isPending;
  useLeaveGuard(changeCount > 0 || invalidCount > 0);

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (!settings) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-signal-warn">
            {query.error?.message ?? "The robot's settings could not be read."}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const setDraft = (id: string, value: string | boolean) => {
    update.reset();
    reset.reset();
    setDrafts((current) => ({ ...current, [id]: value }));
  };
  const dropDrafts = (ids?: string[]) =>
    setDrafts((current) =>
      ids ? Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))) : {},
    );

  const save = () => {
    if (!changeCount || invalidCount || busy) return;
    update
      .mutateAsync(changes, { onSuccess: () => dropDrafts() })
      .catch(() => {});
  };
  const resetOne = (id: string) => {
    update.reset();
    reset.mutateAsync([id], { onSuccess: () => dropDrafts([id]) }).catch(() => {});
  };
  const resetAll = () => {
    update.reset();
    reset
      .mutateAsync(undefined, {
        onSuccess: () => {
          dropDrafts();
          setConfirmingReset(false);
        },
      })
      .catch(() => {});
  };

  const error = update.error ?? reset.error;
  const pendingRestart = fields.some((field) => field.pending_restart);
  const anyModified = fields.some((field) => field.modified);

  const dirty = changeCount > 0 || invalidCount > 0;

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {(!settings.live_available || pendingRestart) && (
        <div className="space-y-2">
          {!settings.live_available && (
            <Notice>
              Navigation is not running, so these are the saved settings. A change is
              saved now and takes effect when the robot next starts navigating.
            </Notice>
          )}
          {pendingRestart && (
            <Notice tone="caution">
              Some saved changes take effect only after the robot restarts — use Restart
              on the Settings page when the robot is free.
            </Notice>
          )}
        </div>
      )}

      {settings.groups.map((group) => {
        const members = fields.filter((field) => field.group === group.id);
        if (!members.length) return null;
        const headingId = `settings-group-${group.id}`;
        return (
          // The group's words beside its card from lg up: a heading over a
          // full-width card left each label a screen's width from its value,
          // and a 10 px label over 14 px rows read as the lesser of the two.
          <section
            key={group.id}
            aria-labelledby={headingId}
            className="grid gap-3 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8"
          >
            <div className="lg:pt-3">
              <h2 id={headingId} className="text-sm font-medium">
                {group.label}
              </h2>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">
                {group.description}
              </p>
            </div>
            <Card className="py-0">
              <CardContent className="divide-y divide-hairline px-0">
                {members.map((field) => (
                  <SettingRow
                    key={field.id}
                    field={field}
                    draft={draftOf(field, drafts)}
                    invalid={invalid[field.id] ?? null}
                    changed={field.id in changes}
                    disabled={busy}
                    onChange={(value) => setDraft(field.id, value)}
                    onReset={() => resetOne(field.id)}
                  />
                ))}
              </CardContent>
            </Card>
          </section>
        );
      })}

      {/* At the end, not in the save bar: it undoes every setting at once, so
          it is kept away from the buttons pressed after each edit. */}
      {anyModified && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4 lg:ml-[calc(14rem+2rem)]">
          <p className="text-xs text-muted-foreground">
            Changed settings show the default under their value.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmingReset(true)}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset all to defaults
          </Button>
        </div>
      )}

      {/* Only while there is something to save or a refusal to read: a bar
          that is always there, Save greyed, was a fifth of a phone's screen
          saying nothing. Sticky so it stays in reach below a long list. */}
      {(dirty || error) && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-hairline bg-background/95 px-4 py-3 backdrop-blur">
          {error && (
            // The robot's own sentence; it is written for operators.
            <p role="alert" className="mb-2 text-sm text-signal-warn">
              {error.message}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-muted-foreground">
              {invalidCount
                ? `${invalidCount} ${invalidCount === 1 ? "value needs" : "values need"} fixing`
                : changeCount
                  ? `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"}`
                  : null}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !dirty}
                onClick={() => {
                  update.reset();
                  dropDrafts();
                }}
              >
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={busy || !changeCount || invalidCount > 0}>
                <SaveIcon data-icon="inline-start" />
                {update.isPending
                  ? "Saving…"
                  : changeCount
                    ? `Save ${changeCount} ${changeCount === 1 ? "change" : "changes"}`
                    : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmingReset}
        onOpenChange={(open) => {
          if (!open && !reset.isPending) setConfirmingReset(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset every setting to its default?</AlertDialogTitle>
            <AlertDialogDescription>
              Every setting changed on this robot goes back to the robot&apos;s default.
              Settings that apply at once change now; the rest after the next restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {reset.error && (
            <p role="alert" className="text-sm text-signal-warn">
              {reset.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={reset.isPending}
              onClick={() => setConfirmingReset(false)}
            >
              Keep my settings
            </Button>
            <Button size="sm" disabled={reset.isPending} onClick={resetAll}>
              <RotateCcwIcon data-icon="inline-start" />
              {reset.isPending ? "Resetting…" : "Reset all"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

/**
 * One setting: what it does, how it takes effect, its value and its default.
 * The default and the per-setting reset show only once the robot keeps a
 * value of its own, which is the only time either says anything.
 */
function SettingRow({
  field,
  draft,
  invalid,
  changed,
  disabled,
  onChange,
  onReset,
}: {
  field: SettingField;
  draft: string | boolean;
  invalid: string | null;
  changed: boolean;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
  onReset: () => void;
}) {
  const inputId = `setting-${field.id}`;
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const unitId = `${inputId}-unit`;

  const range = rangeText(field);

  return (
    <div
      // An unsaved edit marks its whole row, not only a chip by the label, so
      // a Save can be checked at a glance before it is pressed.
      className={cn(
        "grid gap-3 px-4 py-3.5 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6",
        changed && "bg-signal-cmd/6 shadow-[inset_3px_0_0_var(--color-signal-cmd)]",
        invalid && "bg-signal-warn/6 shadow-[inset_3px_0_0_var(--color-signal-warn)]",
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Label htmlFor={inputId}>{field.label}</Label>
          {field.apply === "restart" && (
            <Chip title="Takes effect the next time the robot starts navigating.">
              After restart
            </Chip>
          )}
          {field.apply === "idle" && (
            <Chip title="Can only be changed while the robot is not navigating.">
              While stopped
            </Chip>
          )}
          {field.pending_restart && <Chip tone="caution">Restart to apply</Chip>}
        </div>
        <p id={descriptionId} className="max-w-prose text-xs leading-snug text-muted-foreground">
          {field.description}
        </p>
        {invalid && (
          <p id={errorId} role="alert" className="text-xs text-signal-warn">
            {invalid}
          </p>
        )}
      </div>

      {/* A fixed-width column, so every value in a card lines up under the
          one above it. */}
      <div className="flex flex-col items-start gap-1 sm:w-36 sm:items-end">
        {field.kind === "boolean" ? (
          <Switch
            id={inputId}
            checked={draft === true}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked)}
            aria-describedby={descriptionId}
          />
        ) : (
          // The unit inside the box: beside it, it hung in a column of its
          // own and read as belonging to the next row as often as this one.
          <div className="relative w-36">
            <Input
              id={inputId}
              value={typeof draft === "string" ? draft : ""}
              disabled={disabled}
              // Not type="number": it reports "" for "1." and "-", erasing
              // what is halfway typed (param-fields.tsx says the same).
              inputMode={field.kind === "integer" ? "numeric" : "decimal"}
              onChange={(event) => onChange(event.target.value)}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={cn(descriptionId, invalid && errorId, field.unit && unitId)}
              className={cn("readout text-right text-[13px]", field.unit && "pr-14")}
            />
            {field.unit && (
              <span
                id={unitId}
                className="pointer-events-none absolute inset-y-0 right-2.5 flex w-10 items-center text-[11px] text-muted-foreground"
              >
                {field.unit}
              </span>
            )}
          </div>
        )}
        {/* The limits before a value is typed, not only after one is refused. */}
        {range && <span className="readout text-[11px] text-muted-foreground">{range}</span>}
        {field.modified && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {field.default !== null && (
              <span>
                Default <span className="readout">{formatWithUnit(field, field.default)}</span>
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled}
              onClick={onReset}
              aria-label={`Reset ${field.label} to its default`}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Reset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** "0.4 – 1 m/s", "at least 5 s", or null for a setting with no limits. */
function rangeText(field: SettingField): string | null {
  if (field.kind === "boolean") return null;
  const unit = field.unit ? ` ${field.unit}` : "";
  if (field.min !== null && field.max !== null) {
    return `${formatValue(field.min)} – ${formatValue(field.max)}${unit}`;
  }
  if (field.min !== null) return `at least ${formatValue(field.min)}${unit}`;
  if (field.max !== null) return `at most ${formatValue(field.max)}${unit}`;
  return null;
}

function Notice({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "caution";
  children: React.ReactNode;
}) {
  return (
    <Card className="py-3">
      <CardContent>
        <p
          role="status"
          className={cn(
            "text-sm",
            tone === "caution" ? "text-signal-caution" : "text-muted-foreground",
          )}
        >
          {children}
        </p>
      </CardContent>
    </Card>
  );
}
