"use client";

import * as React from "react";
import { ArrowLeftIcon, MapIcon, NavigationIcon, SaveIcon, XIcon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OctomapLine } from "@/components/mapping/octomap-line";
import { MAP_NAME_HINT, MAP_NAME_RE, resumedSaveProblem } from "@/lib/map/name";
import type { MapSummary } from "@/lib/types/map";

/**
 * Name and save the map the current run built — the run's only durable exit,
 * since the keyframes live in RAM. A save also ends the run.
 *
 * The robot builds the map's 3D map from the scan after every save; it takes
 * minutes, and the map cannot be used until it is done.
 *
 * A dialog, by request: the name is the one thing to think about here, and a
 * strip over a moving picture is not where to think.
 *
 * After the save it stays open as the receipt — the backend's sentence and
 * the 3D map's progress — and, once the build has an outcome, asks the
 * question a finished run leaves: go back to Navigation, or stay to map
 * again. Not before: a switch restarts the robot's software minutes into a
 * build the operator is watching, and whether this map is usable yet is half
 * of what the answer depends on. It is the only place that is shown.
 * Presentational over the page's mutation so the receipt outlives the
 * dialog. Cancel is held while saving: there is no abort, and closing would
 * lose the receipt and the leave-guard's lift.
 *
 * Asked here rather than through the mode switch's own confirm: the run is
 * saved, so nothing is lost, and this receipt already says the one thing
 * that question would — that Navigation comes back on the map loaded before,
 * not this one, which cannot be switched to until its 3D map is built. The
 * build is a detached job on the robot and survives the switch.
 *
 * A run resumed from a saved map is saved as another map: the robot refuses
 * its own name, and what was placed on the old map — waypoints, forbidden
 * zones, ground patches, floors — stays with the old name. Both are said
 * here, before the name is typed, because afterwards the new map simply
 * turns up without them.
 */
export function SaveMapDialog({
  open,
  busy,
  error,
  saved,
  conversion,
  switchHeld,
  resumedFrom,
  onSave,
  onSwitchToNav,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  /** The backend's refusal, verbatim. Shown here, never under the strip. */
  error: string | null;
  /** The backend's receipt, verbatim; non-null flips the dialog to its second face. */
  saved: string | null;
  /** The saved map's catalogue entry while its 3D map is being built. */
  conversion: MapSummary | null;
  /** A mode switch is already on its way. */
  switchHeld: boolean;
  /** The saved map this run continues, or null for a run started from nothing. */
  resumedFrom: string | null;
  onSave: (name: string) => void;
  onSwitchToNav: () => void;
  onClose: () => void;
}) {
  const [name, setName] = React.useState("");
  const nameId = React.useId();
  const problemId = React.useId();
  // Its own line, not the name rule's: the name is well-formed, just taken
  // by the map the run stands on.
  const resumedProblem = resumedSaveProblem(name, resumedFrom);
  const valid = MAP_NAME_RE.test(name) && resumedProblem === null;
  // No entry yet counts as building: the robot lists a saved map as
  // `converting` at once, so it is only the moment before the catalogue's
  // first read. `none` is an outcome — the build never started, which the
  // save's own sentence says.
  const building = conversion === null || conversion.octomap_status === "converting";
  const built = conversion?.octomap_status === "ok";

  const close = () => {
    setName("");
    onClose();
  };

  const switchToNav = () => {
    setName("");
    onSwitchToNav();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Escape lands here; nothing may close it mid-save.
        if (!next && !busy) close();
      }}
    >
      <AlertDialogContent>
        {saved === null ? (
          <form
            // A form so Enter saves; the handler repeats the button's guard.
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && !busy) onSave(name);
            }}
            className="contents"
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Save this map?</AlertDialogTitle>
              <AlertDialogDescription>
                The run lives in the robot&apos;s memory until saved. Saving
                ends the run and can take a minute on a large site; the robot
                then builds the map&apos;s 3D map, which takes several minutes.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {resumedFrom !== null && (
              <p className="text-sm break-words text-muted-foreground">
                This run continues <span className="readout text-foreground">{resumedFrom}</span>,
                so it is saved as a new map under a new name. {resumedFrom} stays
                as it is and keeps its waypoints, forbidden zones, ground
                patches and floors — the new map starts without them.
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={nameId} className="text-xs">
                Map name
              </Label>
              <Input
                id={nameId}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="site_a"
                aria-invalid={name.length > 0 && !valid ? true : undefined}
                aria-describedby={resumedProblem !== null ? problemId : undefined}
                disabled={busy}
                className="readout h-8 rounded-sm"
              />
              {/* Shown only while the name breaks the rule, as on import and rename. */}
              {name.length > 0 && !MAP_NAME_RE.test(name) && (
                <p className="text-[11px] leading-snug text-signal-caution">
                  {MAP_NAME_HINT}
                </p>
              )}
              {resumedProblem !== null && (
                <p id={problemId} className="text-[11px] leading-snug break-words text-signal-caution">
                  {resumedProblem}
                </p>
              )}
            </div>

            {/* Name taken, nothing to save, wrong mode — the backend's sentence. */}
            {error && (
              <ErrorLine>
                {error}
              </ErrorLine>
            )}

            <AlertDialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={close}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!valid || busy}>
                <SaveIcon data-icon="inline-start" />
                {busy ? "Saving…" : "Save"}
              </Button>
            </AlertDialogFooter>
          </form>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Map saved</AlertDialogTitle>
              <AlertDialogDescription>{saved}</AlertDialogDescription>
            </AlertDialogHeader>

            {/* Under the receipt, not replacing it: one says the scan is on
              * disk, the other how the 3D map went. */}
            <OctomapLine map={conversion} />

            {building ? (
              <AlertDialogFooter>
                {/* Closing leaves the build running: it is a job on the robot,
                  * not on this dialog. */}
                <Button type="button" variant="ghost" size="sm" autoFocus onClick={close}>
                  <XIcon data-icon="inline-start" />
                  Close
                </Button>
              </AlertDialogFooter>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Switch the robot back to Navigation? It restarts its software
                  on the map it was using before, not this one — switch to this
                  map from the map library
                  {built ? "" : " once its 3D map is ready"}. This console
                  loses contact for about 30 seconds.
                </p>

                <AlertDialogFooter>
                  {/* Stay is the focused answer: a switch restarts the robot, so
                    * Enter must not be what sends it. */}
                  <Button type="button" variant="ghost" size="sm" autoFocus onClick={close}>
                    <MapIcon data-icon="inline-start" />
                    Stay in Mapping
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={switchHeld}
                    onClick={switchToNav}
                  >
                    <NavigationIcon data-icon="inline-start" />
                    Switch to Navigation
                  </Button>
                </AlertDialogFooter>
              </>
            )}
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
