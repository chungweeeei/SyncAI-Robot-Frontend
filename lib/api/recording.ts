// Recordings: /api/v1/recordings. A recording is one `ros2 bag record` on the
// robot, into `record/<name>/`. Nothing reads them back; they are insurance
// against a mapping run lost without a save. Fields mirror the backend's
// snake_case names.

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/**
 * - `recording` — the live one; at most one per robot.
 * - `ok` — finished cleanly; `metadata.yaml` written, the bag plays.
 * - `interrupted` — the recorder died unflushed (a mode switch or a crash).
 *   The messages survive; `ros2 bag reindex` rebuilds the missing index.
 *   Derived by the backend, never stored.
 */
export type RecordingStatus = "recording" | "ok" | "interrupted";

export interface ActiveRecording {
  name: string;
  /** Absolute path on the robot. */
  path: string;
  /** Already namespaced by the backend. */
  topics: string[];
  /** ISO 8601, UTC. */
  started_at: string;
  /**
   * **As the robot measures it.** Rendered straight, not interpolated by a
   * local timer, which would be a number this console made up.
   */
  elapsed_seconds: number;
  compression: boolean;
  /** The backend walks the directory per call. */
  size_bytes: number;
}

export interface StoppedRecording {
  name: string;
  path: string;
  topics: string[];
  started_at: string;
  elapsed_seconds: number;
  size_bytes: number;
  /**
   * `sigint` is normal and the only one that flushes; `sigterm` / `sigkill`
   * mean it was wedged, and `complete` is false.
   */
  stopped_by: string;
  /** Whether the bag plays as-is. */
  complete: boolean;
}

export interface RecordingSummary {
  name: string;
  status: RecordingStatus;
  size_bytes: number;
  /** ISO 8601, newest file in the directory. */
  modified_at: string;
  /** Null until finished. */
  duration_seconds: number | null;
  /**
   * Null until finished. **Zero on a finished bag means a topic typo:** a
   * missing topic is not refused (it may appear after bringup), so it records
   * silence.
   */
  message_count: number | null;
  /** Empty while live: written on shutdown. */
  topics: string[];
  /** Null for an uncompressed bag. */
  compression: string | null;
}

const ActiveRecordingSchema: z.ZodType<ActiveRecording> = z.object({
  name: z.string(),
  path: z.string(),
  topics: z.array(z.string()),
  started_at: z.string(),
  elapsed_seconds: z.number(),
  compression: z.boolean(),
  size_bytes: z.number(),
});

const StoppedRecordingSchema: z.ZodType<StoppedRecording> = z.object({
  name: z.string(),
  path: z.string(),
  topics: z.array(z.string()),
  started_at: z.string(),
  elapsed_seconds: z.number(),
  size_bytes: z.number(),
  stopped_by: z.string(),
  complete: z.boolean(),
});

const RecordingSummarySchema: z.ZodType<RecordingSummary> = z.object({
  name: z.string(),
  status: z.enum(["recording", "ok", "interrupted"]),
  size_bytes: z.number(),
  modified_at: z.string(),
  duration_seconds: z.number().nullable(),
  message_count: z.number().nullable(),
  topics: z.array(z.string()),
  compression: z.string().nullable(),
});

export interface StartRecordingRequest {
  /** Omitted for the backend's `rec_<UTC timestamp>` default. */
  name?: string;
  /**
   * A relative name is resolved under the robot's namespace by the backend, so
   * no robot id is spelled here; an absolute one (`/tf`) passes through.
   */
  topics?: string[];
  /** Per closed 2 GB split. Off by default. */
  compression?: boolean;
}

/**
 * A 201 means the recorder is running, not that the bag will be good.
 * Refused before spawning: one at a time, a taken name, under 2 GB free.
 */
export function startRecording(
  request: StartRecordingRequest,
): Promise<ActiveRecording> {
  return requestJson<ActiveRecording>(apiUrl("/api/v1/recordings"), {
    method: "POST",
    body: JSON.stringify(request),
    schema: ActiveRecordingSchema,
  });
}

export function fetchActiveRecording(
  signal?: AbortSignal,
): Promise<ActiveRecording | null> {
  return requestJson<ActiveRecording | null>(
    apiUrl("/api/v1/recordings/active"),
    // Null means "nothing is recording".
    { signal, schema: ActiveRecordingSchema.nullable() },
  );
}

/**
 * Stop and wait for the bag to close (up to ~22 s when escalated), since
 * whether it plays is only known then. Read `complete`, not the status.
 */
export function stopRecording(): Promise<StoppedRecording> {
  return requestJson<StoppedRecording>(apiUrl("/api/v1/recordings/stop"), {
    method: "POST",
    schema: StoppedRecordingSchema,
  });
}

export function fetchRecordings(
  signal?: AbortSignal,
): Promise<RecordingSummary[]> {
  return requestJson<{ recordings: RecordingSummary[] }>(
    apiUrl("/api/v1/recordings"),
    { signal, schema: z.object({ recordings: z.array(RecordingSummarySchema) }) },
  ).then((body) => body.recordings);
}

/** No undo. Refused for the live recording. */
export function deleteRecording(name: string): Promise<void> {
  return requestJson<void>(
    apiUrl(`/api/v1/recordings/${encodeURIComponent(name)}`),
    { method: "DELETE", parse: false },
  );
}
