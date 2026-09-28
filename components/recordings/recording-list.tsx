"use client";

import { Chip } from "@/components/console/instrument";
import { RecordingDeleteControl } from "@/components/recordings/recording-delete-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordings } from "@/hooks/use-recordings";
import type { RecordingSummary } from "@/lib/api/recording";
import { formatSize, formatTimestamp } from "@/lib/recording/format";

/** Same panel shape /maps and /settings use when there is nothing to list. */
function Notice({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline bg-panel p-4">
      <p className="instrument-label text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm">{children}</p>
    </div>
  );
}

/**
 * The chip a row carries, or nothing for a bag that is simply fine.
 *
 * `ok` renders nothing on purpose — the map library's rule: a chip on every
 * healthy row is a column of the word "fine" on a screen whose question is
 * which bags are here. Tones are the console's EFIS semantic: `interrupted` is
 * a bag that is not done rather than a fault, so it takes caution, not warn.
 */
function StatusChip({ recording }: { recording: RecordingSummary }) {
  if (recording.status === "recording") {
    return <Chip tone="warn">Recording</Chip>;
  }
  if (recording.status === "interrupted") {
    return (
      // The chip is all an interrupted row says now: the paragraph under it
      // (cut short by a restart, needs repairing, contact support) was
      // removed by request, so the hover title carries the one fact left.
      <Chip tone="caution" title="This recording did not close cleanly.">
        No index
      </Chip>
    );
  }
  return null;
}

/**
 * A bag that recorded nothing, which is almost always a topic that was never
 * published under the name it was given.
 *
 * Worth its own line rather than leaving the operator to notice a zero: nothing
 * in the pipeline refuses an unknown topic — the recorder waits for it, so that
 * it can be armed before bringup — which makes a typo completely silent right
 * up until the bag is needed.
 */
function EmptyWarning({ recording }: { recording: RecordingSummary }) {
  if (recording.status !== "ok" || recording.message_count !== 0) return null;
  return (
    <p className="mt-1 text-[11px] leading-snug text-signal-caution">
      This recording is empty — the channels it was set to record sent nothing
      while it ran.
    </p>
  );
}

/**
 * Why the delete control beside a live recording does nothing. The control
 * carries the same reason as a hover title, which a finger never sees.
 */
function LiveHint({ recording }: { recording: RecordingSummary }) {
  if (recording.status !== "recording") return null;
  return (
    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
      Still recording — it can be deleted once it has been stopped.
    </p>
  );
}

/** One measured value in the row's right-hand cluster. */
function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="instrument-label text-muted-foreground">{label}</span>
      <span className="readout mt-0.5 text-[13px] leading-none font-medium">
        {value}
      </span>
    </div>
  );
}

function RecordingRow({ recording }: { recording: RecordingSummary }) {
  const live = recording.status === "recording";

  return (
    // Stacked below sm: the numbers beside the name left it ~60 px at 375,
    // which is an ellipsis.
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="readout truncate text-sm font-medium">
            {recording.name}
          </span>
          <StatusChip recording={recording} />
          {/* The format itself is an internal name (zstd on this robot), so
            * the chip says only what it means for the operator: the files are
            * smaller than the raw data and play back the same. */}
          {recording.compression && (
            <Chip tone="neutral" title="Stored compressed. Plays back the same.">
              Compressed
            </Chip>
          )}
        </div>

        {/* wrap-anywhere: channel paths have no spaces to break on. */}
        <p className="mt-1 text-[11px] leading-tight wrap-anywhere text-muted-foreground">
          {formatTimestamp(recording.modified_at)}
          {/* Live bags have no topic list yet: rosbag2 writes it into
            * metadata.yaml on shutdown, so until then the recorder panel above
            * is the only place the topics exist. Saying so beats an empty row
            * that reads as "recorded nothing". */}
          {recording.topics.length > 0
            ? ` · ${recording.topics.join(", ")}`
            : live
              ? " · the recorded channels are listed once it finishes"
              : ""}
        </p>

        <EmptyWarning recording={recording} />
        <LiveHint recording={recording} />
      </div>

      {/* Size only. Length and message count sat beside it and were dropped
        * by request; the message count still drives the empty warning above,
        * which is the one thing it was needed for on this screen. */}
      <div className="flex shrink-0 items-start justify-between gap-4 sm:justify-start">
        <Cell label="Size" value={formatSize(recording.size_bytes)} />
        <RecordingDeleteControl recording={recording} />
      </div>
    </li>
  );
}

function LoadingList() {
  return (
    <div
      className="divide-y divide-hairline rounded-md border border-hairline bg-panel"
      aria-busy
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Every bag on the robot, newest first — the order the backend answers in,
 * which is the order they are looked for.
 *
 * A row list rather than the map library's card grid: a bag has no picture, and
 * its size reads as a column. The live recording stays in the list
 * with its own chip instead of being filtered out; the panel above says what it
 * is doing, and a row that vanished while recording and reappeared on stop
 * would be the one moment the list looked wrong.
 */
export function RecordingList() {
  const { recordings, status } = useRecordings();

  if (!recordings) {
    if (status === "error") {
      return (
        <Notice label="Recordings unavailable">
          The robot&apos;s recording list could not be read.
        </Notice>
      );
    }
    return <LoadingList />;
  }

  if (recordings.length === 0) {
    return (
      <Notice label="No recordings">
        Nothing has been recorded on this robot. Bags are written to{" "}
        <span className="readout">record/&lt;name&gt;/</span> and stay there
        until deleted.
      </Notice>
    );
  }

  return (
    <ul className="divide-y divide-hairline rounded-md border border-hairline bg-panel">
      {recordings.map((recording) => (
        <RecordingRow key={recording.name} recording={recording} />
      ))}
    </ul>
  );
}
