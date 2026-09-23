"use client";

import * as React from "react";
import { CircleIcon, SquareIcon } from "lucide-react";

import { RecordDot, Readout } from "@/components/console/instrument";
import { TopicPicker, DEFAULT_TOPICS } from "@/components/recordings/topic-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useStartRecording, useStopRecording } from "@/hooks/use-recorder";
import { useActiveRecording } from "@/hooks/use-recordings";
import type { ActiveRecording, StoppedRecording } from "@/lib/api/recording";
import { formatDuration, formatSize, formatTimestamp } from "@/lib/recording/format";
import {
  RECORDING_NAME_RE,
  RESERVED_RECORDING_NAME,
} from "@/lib/recording/name";
import { cn } from "@/lib/utils";

/** The live recorder: what is being written, and the one way to end it. */
function LiveRecorder({
  active,
  busy,
  onStop,
}: {
  active: ActiveRecording;
  busy: boolean;
  onStop: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="instrument-label flex items-center gap-2 text-signal-warn">
            <RecordDot />
            Recording
          </span>
          {/* The elapsed clock is the robot's own number, arriving once a
            * second. A local timer counting up from started_at would keep
            * ticking through a dropped connection and a dead recorder — the two
            * states this readout exists to expose. */}
          <p className="readout mt-2 text-3xl leading-none font-medium text-signal-warn">
            {formatDuration(active.elapsed_seconds)}
          </p>
        </div>

        {/* Not `destructive`: in this console red means faulted, and stopping
          * is the act that makes the bag playable. It is the commanded hue like
          * every other thing the operator does deliberately. */}
        <Button type="button" size="sm" disabled={busy} onClick={onStop}>
          <SquareIcon data-icon="inline-start" />
          {busy ? "Stopping…" : "Stop"}
        </Button>
      </div>

      <div className="space-y-1.5">
        <Readout label="Written" value={formatSize(active.size_bytes)} tone="live" />
        <Readout
          label="Channels"
          value={active.topics.length}
          tone="cmd"
          className="cursor-default"
        />
        <Readout label="Started" value={formatTimestamp(active.started_at)} />
        <Readout label="Name" value={active.name} />
      </div>

      {/* The resolved names, which is what actually went to the recorder — the
        * picker showed the relative spelling and the backend expanded it. Worth
        * the four lines: a topic namespaced onto the wrong robot is invisible
        * anywhere else until the bag comes back empty. */}
      <ul className="space-y-0.5">
        {active.topics.map((topic) => (
          <li
            key={topic}
            className="readout text-[11px] leading-tight break-all text-muted-foreground"
          >
            {topic}
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-tight text-muted-foreground">
        Stopping closes the file so it can be played back later. Leaving this
        page does not stop the recording.
      </p>
    </div>
  );
}

/** How the last recording ended. Held until the next one starts. */
function StoppedLine({ stopped }: { stopped: StoppedRecording }) {
  if (!stopped.complete) {
    return (
      <p className="text-[11px] leading-snug text-signal-caution">
        {stopped.name} did not close cleanly, so it cannot be used as it is.
        The recorded data is safe on the robot and can be repaired — contact
        support if you need this one.
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-snug text-signal-live">
      Saved {stopped.name} — {formatDuration(stopped.elapsed_seconds)},{" "}
      {formatSize(stopped.size_bytes)}.
    </p>
  );
}

/**
 * Start and stop the robot's bag recorder.
 *
 * The page's one live instrument, and the only control on it: the catalogue
 * below is a record of what this panel has done. It has two faces rather than
 * one with disabled parts, because the two states share no fields — idle asks
 * what to record, live reports what is being recorded — and a start form greyed
 * out under a running recorder would invite filling in a name that cannot be
 * used.
 *
 * Which face is shown comes from the server, not from a local "we pressed
 * Start" flag. That is what makes the panel correct about a recording started
 * from a shell on the robot or from a second console, and about one that died
 * on its own — the backend reaps a dead recorder on the same read.
 *
 * Refusals are the backend's sentences verbatim, as everywhere else in this
 * console: one recording at a time, a name already on disk, and less than 2 GB
 * free. The last one is the only one that asks the operator to go and do
 * something, and what it asks for — delete a recording — is the list below.
 */
export function RecorderControl() {
  const { active, status } = useActiveRecording();
  const start = useStartRecording();
  const stop = useStopRecording();

  const [name, setName] = React.useState("");
  const [topics, setTopics] = React.useState<string[]>(DEFAULT_TOPICS);
  const [compression, setCompression] = React.useState(false);

  // One panel, two writes: whichever was pressed last owns the busy flag and
  // the error line, and starting a recording clears the last stop's receipt.
  // Each press resets the other mutation to keep that true.
  const busy = start.isPending || stop.isPending;
  const error = (start.error ?? stop.error)?.message ?? null;
  const stopped: StoppedRecording | null = stop.data ?? null;

  // Empty is valid — the backend names the bag `rec_<UTC timestamp>` and that
  // is the right default for the run somebody is about to drive.
  const nameValid =
    name.length === 0 ||
    (RECORDING_NAME_RE.test(name) && name !== RESERVED_RECORDING_NAME);

  const submitStart = () => {
    stop.reset();
    start.mutate(
      { name: name.trim() || undefined, topics, compression },
      { onSuccess: () => setName("") },
    );
  };

  const submitStop = () => {
    start.reset();
    stop.mutate();
  };

  return (
    <section className="rounded-md border border-hairline bg-panel px-4 py-3.5">
      <h2 className="instrument-label mb-3 text-muted-foreground">Recorder</h2>

      {/* Nothing committal until the first answer: showing the start form while
        * the robot might already be recording would offer a button that can
        * only 409. */}
      {status === "loading" ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          Checking the recorder…
        </p>
      ) : active ? (
        <LiveRecorder active={active} busy={busy} onStop={submitStop} />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && nameValid && topics.length > 0) submitStart();
          }}
          className="space-y-3"
        >
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="recording name (optional)"
              aria-label="Recording name"
              disabled={busy}
              className="h-8 flex-1 text-sm"
            />
            <Button type="submit" size="sm" disabled={busy || !nameValid || topics.length === 0}>
              <CircleIcon data-icon="inline-start" />
              {busy ? "Starting…" : "Start recording"}
            </Button>
          </div>

          {/* Shown only while the name breaks the rule — a resting hint would
            * be chrome on a field that is usually left empty. */}
          {!nameValid && (
            <p className="text-[11px] leading-snug text-signal-caution">
              {name === RESERVED_RECORDING_NAME
                ? "“active” is a reserved name — please choose another."
                : "Letters, digits, dot, dash and underscore only, up to 64 characters."}
            </p>
          )}

          <TopicPicker value={topics} onChange={setTopics} disabled={busy} />

          {topics.length === 0 && (
            <p className="text-[11px] leading-snug text-signal-caution">
              Pick at least one channel to record.
            </p>
          )}

          <div className="flex items-start justify-between gap-4 border-t border-hairline pt-3">
            <div>
              <Label htmlFor="bag-compression">Compress the recording</Label>
              <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
                Roughly halves the space a recording takes, at the cost of some
                of the robot&apos;s processing power. Leave it off while mapping.
              </p>
            </div>
            <Switch
              id="bag-compression"
              checked={compression}
              onCheckedChange={setCompression}
              disabled={busy}
            />
          </div>
        </form>
      )}

      {stopped && (
        <div className={cn(active ? "mt-3" : "mt-3 border-t border-hairline pt-3")}>
          <StoppedLine stopped={stopped} />
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 text-[11px] leading-snug break-words text-signal-warn"
        >
          {error}
        </p>
      )}
    </section>
  );
}
