"use client";

import { Chip } from "@/components/console/instrument";
import { RecordingDeleteControl } from "@/components/recordings/recording-delete-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordings } from "@/hooks/use-recordings";
import type { RecordingSummary } from "@/lib/api/recording";
import { formatSize, formatTimestamp } from "@/lib/recording/format";

/** The empty / failed panel /maps and /settings use. */
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
 * A row's chip, or nothing for a healthy recording — a column of "fine" would
 * be noise. `interrupted` is unfinished rather than faulted, so caution.
 */
function StatusChip({ recording }: { recording: RecordingSummary }) {
  if (recording.status === "recording") {
    return <Chip tone="warn">Recording</Chip>;
  }
  if (recording.status === "interrupted") {
    return (
      // The explanatory paragraph was removed by request; the title keeps the fact.
      <Chip tone="caution" title="This recording did not close cleanly.">
        No index
      </Chip>
    );
  }
  return null;
}

/**
 * A recording with no messages — almost always a channel never published
 * under the name given. The recorder waits for unknown channels rather than
 * refusing them, so a typo is otherwise silent until the recording is needed.
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

/** Why the delete control beside a live recording does nothing — its hover title never reaches a finger. */
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
    // Stacked below sm, where the numbers left the name ~60 px.
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="readout truncate text-sm font-medium">
            {recording.name}
          </span>
          <StatusChip recording={recording} />
          {/* The format is an internal name, so the chip says what it means. */}
          {recording.compression && (
            <Chip tone="neutral" title="Stored compressed. Plays back the same.">
              Compressed
            </Chip>
          )}
        </div>

        {/* wrap-anywhere: channel paths have no spaces to break on. */}
        <p className="mt-1 text-[11px] leading-tight wrap-anywhere text-muted-foreground">
          {formatTimestamp(recording.modified_at)}
          {/* A live recording's channel list is only written on shutdown; say
            * so rather than show a row that reads as "recorded nothing". */}
          {recording.topics.length > 0
            ? ` · ${recording.topics.join(", ")}`
            : live
              ? " · the recorded channels are listed once it finishes"
              : ""}
        </p>

        <EmptyWarning recording={recording} />
        <LiveHint recording={recording} />
      </div>

      {/* Size only, by request; the message count still drives EmptyWarning. */}
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
 * Every recording on the robot, newest first (the backend's order).
 *
 * The live one stays in the list with its chip: a row that vanished while
 * recording and reappeared on stop would look wrong.
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
