// Shared plumbing for the backend REST clients in this directory.

import type { z } from "zod";

/** A refusal as the backend describes it. */
export interface ErrorBody {
  /**
   * Operator-facing sentence, rendered verbatim. The domain-exception handlers
   * write these to be read ("Map vertex <id> was not found in 'dp2f'."), which
   * is why unwrapping `detail` is what puts the actionable half on screen
   * instead of a status code. Falls back to the status line.
   */
  detail: string;
  /** A stable machine-readable reason, on the endpoints that publish one. */
  code?: string;
}

/**
 * Read a refusal body — **once**.
 *
 * Once is the point. A Response body can be consumed a single time, so an
 * endpoint whose 409 carries a `code` the UI branches on cannot unwrap the
 * sentence and then go looking for the code. Two of them do (the gridmap
 * convert and the map switch), and each used to carry its own copy of this
 * parse next to its own copy of the fallback string.
 */
export async function errorBody(res: Response): Promise<ErrorBody> {
  try {
    const body = (await res.json()) as { detail?: unknown; code?: unknown };
    const code = typeof body.code === "string" ? body.code : undefined;
    // FastAPI reports errors as {detail: string}, or a 422 validation array.
    if (typeof body.detail === "string") return { detail: body.detail, code };
    if (body.detail) return { detail: JSON.stringify(body.detail), code };
    return { detail: statusLine(res), code };
  } catch {
    // Non-JSON body (a proxy error page); the status line is all there is.
    return { detail: statusLine(res) };
  }
}

/** The operator-facing half of a refusal, for a caller with no code to read. */
export async function errorDetail(res: Response): Promise<string> {
  return (await errorBody(res)).detail;
}

function statusLine(res: Response): string {
  return `${res.status} ${res.statusText}`;
}

export interface JsonRequestInit<T = unknown> extends RequestInit {
  /**
   * Pass `false` for an endpoint with no body — a 204, or a DELETE whose
   * envelope nothing reads. The response is then not parsed.
   */
  parse?: boolean;
  /**
   * Turn a refusal into a typed error, for the two endpoints whose `code` the
   * UI branches on. Return undefined to fall through to a plain Error carrying
   * the sentence, which is what every other refusal wants.
   */
  mapError?: (body: ErrorBody, res: Response) => Error | undefined;
  /**
   * Check the answer before it is believed.
   *
   * Every read used to be an `as T` cast, which is a promise about the backend
   * rather than a check on it — a renamed field arrived as `undefined` and
   * surfaced pages later as a blank readout or a crash inside a render. Passing
   * the schema turns that into one error, at the boundary, naming the field.
   *
   * Reads pass one; writes do not, because the risk there is the *request*
   * shape and that is already closed by the request types.
   */
  schema?: z.ZodType<T>;
}

/**
 * The endpoint path, for an error an operator or an on-call engineer reads.
 * Falls back to the whole URL if it will not parse, which it always does —
 * apiUrl builds it.
 */
function endpointOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Parse a response body, or throw one sentence naming the endpoint and the
 * field that did not match.
 *
 * The message says the console and the robot disagree, rather than showing a
 * validation dump: by the time this fires the useful action is comparing the
 * two versions, not reading a stack. Everything in this console renders
 * `error.message` verbatim, so it has to stand on its own.
 */
function parseWire<T>(schema: z.ZodType<T>, body: unknown, url: string): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const where = result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(
    `${endpointOf(url)} answered in a shape this console does not understand ` +
      `(${where}). The robot is probably running a backend from a different ` +
      `build than this frontend.`,
  );
}

/**
 * A JSON round trip against the backend, throwing the backend's own sentence.
 *
 * **`Content-Type` is only sent when there is a body**, and that is not
 * tidiness. The console is served from :3001 and the backend answers on :3000,
 * so every request here is cross-origin; a GET carrying `Content-Type` leaves
 * the CORS safelist and costs an `OPTIONS` round trip before it. FastAPI has no
 * use for the header on a bodyless request either way, so the branch buys a
 * preflight back on every read — including the catalogue poll that runs while a
 * gridmap converts.
 *
 * The header is built through `Headers` rather than an object spread so that
 * all three shapes the DOM accepts work: spreading a `Headers` instance yields
 * `{}`, which would silently drop a caller's headers and send JSON instead — an
 * `application/octet-stream` PUT losing its type that way would have the server
 * parse a cell buffer as JSON. An explicit `Content-Type` always wins.
 *
 * Pass `T = void` with `parse: false` for an endpoint whose body nothing reads.
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
  return schema ? parseWire(schema, body, url) : (body as T);
}

/**
 * A request whose *success* body is not JSON, for a caller that wants the
 * Response itself — the gridmap image is read as a Blob and decoded pixel by
 * pixel.
 *
 * Refusals still arrive as `{detail}`, so the failure half is identical to
 * requestJson's; only the success half differs, which is the whole reason this
 * is a second function rather than an option.
 */
export async function requestRaw(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await errorDetail(res));
  return res;
}
