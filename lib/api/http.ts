// Shared plumbing for the backend REST clients in this directory.

import type { z } from "zod";

/** A refusal as the backend describes it. */
export interface ErrorBody {
  /** Operator-facing sentence, rendered verbatim; else the status line. */
  detail: string;
  /** A stable machine-readable reason, where the endpoint publishes one. */
  code?: string;
  /**
   * `step_id`: the task-body step a task, template or schedule write refuses.
   * The editor marks that row, covering rules it does not mirror.
   */
  stepId?: string;
}

/**
 * Read a refusal body — **once**: a Response body can be consumed a single
 * time, so the sentence and the `code` have to come out together.
 */
export async function errorBody(res: Response): Promise<ErrorBody> {
  try {
    const body = (await res.json()) as { detail?: unknown; code?: unknown; step_id?: unknown };
    const code = typeof body.code === "string" ? body.code : undefined;
    const stepId = typeof body.step_id === "string" ? body.step_id : undefined;
    // FastAPI reports errors as {detail: string}, or a 422 validation array.
    if (typeof body.detail === "string") return { detail: body.detail, code, stepId };
    if (body.detail) return { detail: JSON.stringify(body.detail), code, stepId };
    return { detail: statusLine(res), code, stepId };
  } catch {
    // Non-JSON body (a proxy error page); the status line is all there is.
    return { detail: statusLine(res) };
  }
}

export async function errorDetail(res: Response): Promise<string> {
  return (await errorBody(res)).detail;
}

function statusLine(res: Response): string {
  return `${res.status} ${res.statusText}`;
}

export interface JsonRequestInit<T = unknown> extends RequestInit {
  /** `false` for an answer nothing reads (a 204, a DELETE's envelope). */
  parse?: boolean;
  /**
   * Turn a refusal into a typed error, for an endpoint whose `code` the UI
   * branches on; undefined falls through to a plain Error.
   */
  mapError?: (body: ErrorBody, res: Response) => Error | undefined;
  /**
   * Check the answer before it is believed, so a renamed field fails here,
   * named, rather than as a blank readout pages later.
   */
  schema?: z.ZodType<T>;
}

function endpointOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isWrite(method: string): boolean {
  const verb = method.toUpperCase();
  return verb !== "GET" && verb !== "HEAD";
}

/**
 * Parse a body, or throw one sentence naming the endpoint and field: the
 * useful action is comparing versions, not reading a validation dump.
 *
 * A write adds a sentence: it was a 2xx, so the robot already acted, and a
 * Retry on a dispatched MOVE would send the robot again.
 */
function parseWire<T>(
  schema: z.ZodType<T>,
  body: unknown,
  url: string,
  method: string,
): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const where = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  const accepted = isWrite(method)
    ? " The robot accepted the request, so check what it did before sending it again."
    : "";
  throw new Error(
    `${endpointOf(url)} answered in a shape this console does not understand ` +
      `(${where}). The robot is probably running a backend from a different ` +
      `build than this frontend.${accepted}`,
  );
}

/**
 * A JSON round trip, throwing the backend's own sentence.
 *
 * **`Content-Type` only with a body:** every request is cross-origin (:3001 →
 * :3000), and a GET carrying it leaves the CORS safelist and costs a preflight.
 *
 * Built through `Headers`, not an object spread: spreading a `Headers`
 * instance yields `{}`, silently dropping a caller's (e.g. octet-stream) type.
 * An explicit `Content-Type` always wins.
 */
export async function requestJson<T>(
  url: string,
  init?: JsonRequestInit<T>,
): Promise<T> {
  const { parse = true, mapError, schema, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (rest.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...rest, headers });

  if (!res.ok) {
    const body = await errorBody(res);
    throw mapError?.(body, res) ?? new Error(body.detail);
  }

  if (!parse) return undefined as T;
  const body: unknown = await res.json();
  return schema
    ? parseWire(schema, body, url, rest.method ?? "GET")
    : (body as T);
}

/**
 * For a success body that is not JSON (a scan, a 3D map, an archive); refusals are
 * still `{detail}`, handled as in requestJson.
 */
export async function requestRaw(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorDetail(res));
  return res;
}

/**
 * A success body as a Blob, reporting how much of it has arrived as a
 * fraction 0–1 — when the answer declares a `Content-Length` (CORS-safelisted,
 * so readable cross-origin, unlike `Content-Disposition`). Without one, or
 * without a readable stream, it is `res.blob()` and `onProgress` is never
 * called: an unknown total has no fraction, and a guessed one would lie.
 */
export async function readBlob(
  res: Response,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const total = Number(res.headers.get("Content-Length"));
  if (!onProgress || !res.body || !Number.isFinite(total) || total <= 0) {
    return res.blob();
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  onProgress(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(Math.min(received / total, 1));
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "" });
}
