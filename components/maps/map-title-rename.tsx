"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { useRenameMap } from "@/hooks/use-map-actions";
import { MAP_NAME_RE } from "@/lib/map/name";

const DIRTY_REASON =
  "Save your changes first. Renaming a map reloads it, which would throw away anything you have not saved.";

/**
 * The editor's title, and the way to change it — the header-side face of
 * PATCH /api/v1/maps/{name}.
 *
 * Double-click the name and it becomes the input, same face and size; Enter
 * saves, Escape cancels. No Rename button, deliberately: this header is two
 * lines of chrome above a full-viewport canvas, and a button that is pressed
 * once in the life of a map does not earn permanent space beside the one control
 * (Back) that is pressed every visit. The card on /maps keeps its button —
 * there the title is one of nine in a grid, and a double-click on a grid of
 * names is a gesture nobody goes looking for. Here there is exactly one name on
 * screen and it is the page's subject.
 *
 * The `title` tooltip and the hover ground are what make the gesture findable;
 * `MapRenameControl`'s doc explains the rest of the rename's rules, which this
 * shares — the backend refuses `map_active`, `conversion_running` and
 * `name_taken` with a sentence written to be shown, and this shows it rather
 * than pre-greying. It has no MapSummary to pre-grey from, and the editor is
 * reachable for a map in any of those states.
 *
 * The one refusal that is this component's own is `dirty`, and it is not a
 * nicety: a successful rename navigates to /maps/<new>/edit, which reloads the
 * grid from the new directory and drops the buffer. Renaming with unsaved cells
 * would therefore throw them away as a side effect of a name change.
 */
export function MapTitleRename({ name, dirty }: { name: string; dirty: boolean }) {
  const router = useRouter();
  const rename = useRenameMap();

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  /**
   * This component's own refusal (`dirty`), which is not a request outcome and
   * so does not live in the mutation. The backend's refusals do — 409 (active,
   * converting, taken) and 400 arrive as its own sentence, written to be shown.
   */
  const [refusal, setRefusal] = React.useState<string | null>(null);
  /**
   * Held locally rather than read off `rename.data`: the success handler
   * navigates, and a cancel-on-blur racing that navigation resets the mutation
   * — the sentence must survive it.
   */
  const [note, setNote] = React.useState<string | null>(null);

  const busy = rename.isPending;
  const error = refusal ?? rename.error?.message ?? null;

  const trimmed = draft.trim();
  const valid = MAP_NAME_RE.test(trimmed);
  const changed = trimmed !== name;

  const begin = () => {
    if (dirty) {
      // Refused before the input opens rather than on submit: there is nothing
      // the operator could type that would make it allowed, so letting them
      // type first would only be a longer way to say no.
      setRefusal(DIRTY_REASON);
      return;
    }
    setDraft(name);
    setRefusal(null);
    setNote(null);
    rename.reset();
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setRefusal(null);
    // Not while the request is out: `disabled` on the input fires a blur in
    // some browsers, and resetting a pending mutation would detach the success
    // handler that has the navigation in it.
    if (!rename.isPending) rename.reset();
  };

  const submit = () => {
    if (busy) return;
    // Enter on an unchanged name is "I am done here", not a request: close.
    if (!changed) {
      cancel();
      return;
    }
    if (!valid) return;

    rename.mutate(
      { from: name, to: trimmed },
      {
        onSuccess: (result) => {
          setEditing(false);
          setNote(result.message);
          // replace, not push: the URL this page was opened at names a
          // directory that no longer exists, so leaving it in the history is
          // leaving a Back button that lands on a 404.
          // The query rides along: it is what says which mode this editor
          // opened in and where its back button leads (see the page).
          router.replace(`/maps/${encodeURIComponent(trimmed)}/edit${window.location.search}`);
        },
      },
    );
  };

  if (editing) {
    return (
      <div className="min-w-0">
        <p className="instrument-label text-muted-foreground">Rename map</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              // Stopped here, or the editor's window-level Escape — which is
              // deliberately above its typing guard, so that a staged vertex can
              // be dropped from inside its name field — would also fire and
              // disarm the tools because someone abandoned a rename.
              event.stopPropagation();
              cancel();
            }}
            // Blur cancels rather than saves. The next thing under this header is
            // the canvas, so the click that takes focus away is almost always a
            // map gesture: committing a directory rename because the operator
            // looked at something else is the wrong way for this to fail.
            onBlur={cancel}
            aria-label="New map name"
            aria-invalid={trimmed.length > 0 && !valid ? true : undefined}
            disabled={busy}
            className="readout h-7 w-56 rounded-sm px-1.5 text-[15px] font-medium md:text-[15px]"
          />
        </form>

        {/* The rule, shown only while the name breaks it — the same line the
          * card and the save-map row show, because it is the same rule. */}
        {trimmed.length > 0 && !valid && (
          <p className="mt-0.5 text-[11px] leading-snug text-signal-caution">
            Letters, digits, dot, dash and underscore only, up to 64 characters.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <p className="instrument-label text-muted-foreground">Gridmap editor</p>
      {/* Focusable, and Enter or F2 opens it: a double-click is a mouse-only
        * gesture, and refusing to add a button is not a reason to make the one
        * rename path unreachable from the keyboard. F2 because that is what
        * renames a thing in every file manager; Enter because the title is
        * focused and there is only one thing it does. */}
      <h1
        tabIndex={0}
        onDoubleClick={begin}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== "F2") return;
          event.preventDefault();
          begin();
        }}
        title={dirty ? DIRTY_REASON : "Double-click to rename"}
        aria-label={`${name} — double-click or press F2 to rename`}
        className="readout -mx-1 truncate rounded-sm px-1 text-[15px] font-medium transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-cmd"
      >
        {name}
      </h1>
      {error && (
        <p role="alert" className="mt-0.5 text-[11px] leading-snug text-signal-warn">
          {error}
        </p>
      )}
      {/* The renamed title is the receipt that always survives; this sentence —
        * how many vertices and templates were re-keyed with it — is the part
        * worth reading once, and is dropped if the route change remounts the
        * segment rather than re-rendering it. */}
      {note && !error && (
        <p role="status" className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
