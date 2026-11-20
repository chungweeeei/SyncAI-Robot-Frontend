import * as z from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import type { Session } from "@/lib/auth/session";

/** POST /api/v1/auth/login's answer. */
interface LoginAnswer {
  access_token: string;
  token_type: string;
  /** Epoch seconds, on the robot's clock. */
  expires_at: number;
  /** Seconds the token lasts from now. */
  expires_in: number;
}

const LoginAnswerSchema: z.ZodType<LoginAnswer> = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_at: z.number(),
  expires_in: z.number(),
});

export interface Credentials {
  username: string;
  password: string;
}

/**
 * Sign in. A wrong name or password is a 401 whose sentence the form shows
 * as is; there is one account on the robot and no route to add another.
 */
export async function login(
  credentials: Credentials,
  now: () => number = Date.now,
): Promise<Session> {
  const answer = await requestJson<LoginAnswer>(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    body: JSON.stringify(credentials),
    schema: LoginAnswerSchema,
  });
  return toSession(answer, credentials.username, now());
}

/**
 * Trade the session's token, still good, for a fresh one. The token goes on
 * the request like any other (http.ts); a 401 — the robot's cap on how long
 * one sign-in may be renewed, or a token it no longer takes — ends the
 * session there, as every 401 does.
 */
export async function refreshSession(
  username: string,
  now: () => number = Date.now,
): Promise<Session> {
  const answer = await requestJson<LoginAnswer>(apiUrl("/api/v1/auth/refresh"), {
    method: "POST",
    schema: LoginAnswerSchema,
  });
  return toSession(answer, username, now());
}

function toSession(answer: LoginAnswer, username: string, at: number): Session {
  return {
    token: answer.access_token,
    username,
    issuedAt: at,
    // Timed by `expires_in` on this machine's clock, not by `expires_at`: a
    // robot's clock may be hours off a laptop's, which would sign out at once
    // or never. The request's own flight is the error, a second at worst, and
    // a 401 after it signs out anyway.
    expiresAt: at + answer.expires_in * 1000,
  };
}
