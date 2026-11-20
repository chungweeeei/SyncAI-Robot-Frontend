"use client";

import * as React from "react";
import { DownloadIcon } from "lucide-react";

import { ErrorLine } from "@/components/console/error-line";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useRobotId } from "@/hooks/use-console-robot-state";
import { useExportLogs } from "@/hooks/use-export-logs";
import { formatDuration, formatSize } from "@/lib/recording/format";

/** What the bundle holds, in the operator's words: no pane, multilog or journal. */
const CONTENTS = [
  "The last 24 hours",
  "The robot software's logs and the system log",
  "One .tar file, saved to this computer",
];

/**
 * Seconds since `since`, ticking once a second while it is set. The wait
 * before the first byte has no total, and a minute of an unchanging
 * "Collecting…" reads as a hang; a clock that moves says it is working.
 */
function useElapsed(since: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return since === null ? 0 : Math.max(0, (now - since) / 1000);
}

/**
 * The Logs section: the robot's last day of logs, saved as one file for
 * whoever is debugging it. One press, no dialog: a download is undone by
 * deleting the file. The robot builds the bundle before it sends a byte, so
 * the button first counts that wait, then the transfer in percent, the face
 * filling behind it as a map export's does.
 */
export function LogExport() {
  const robotId = useRobotId();
  const exporting = useExportLogs(robotId);
  const elapsed = useElapsed(exporting.startedAt);

  const busy = exporting.isPending;
  const progress = exporting.progress;
  const label =
    progress !== null
      ? `Downloading ${progress}%`
      : busy
        ? `Collecting logs… ${formatDuration(elapsed)}`
        : "Export logs";

  return (
    <Card>
      <CardContent className="space-y-4">
        <ul className="space-y-1 text-sm text-muted-foreground">
          {CONTENTS.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              {line}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button
            type="button"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => {
              exporting.reset();
              exporting.mutate();
            }}
            className="relative overflow-hidden disabled:cursor-progress disabled:opacity-80"
          >
            {progress !== null && (
              // Decoration; the label's percent is the reading.
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-background/25"
                style={{ width: `${progress}%` }}
              />
            )}
            <DownloadIcon data-icon="inline-start" className="relative" aria-hidden />
            <span className="relative tabular-nums">{label}</span>
          </Button>
          {/* Always in the tree, so a screen reader hears the save land. */}
          <p role="status" className="min-w-0 text-[12px] break-words text-muted-foreground">
            {exporting.data ? (
              <>
                Saved{" "}
                <span className="readout break-all">{exporting.data.filename}</span>
                {" · "}
                <span className="readout">{formatSize(exporting.data.bytes)}</span>
              </>
            ) : busy && progress === null
                ? "The robot is gathering its logs. This can take a couple of minutes."
                : ""}
          </p>
        </div>

        <ErrorLine>{exporting.error?.message}</ErrorLine>
      </CardContent>
    </Card>
  );
}
