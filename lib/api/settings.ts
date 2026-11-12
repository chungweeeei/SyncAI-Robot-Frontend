import * as z from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/**
 * A settings page's path segment: the robot node it tunes, in the operator's
 * words (`controller` is the walking controller, `planner` the route planner).
 */
export type SettingsPageId = "controller" | "planner";

/**
 * How a change takes effect, as the robot reads its own node: `live` at
 * once, `idle` at once but refused while the robot navigates (409
 * `controller_busy`), `restart` the next time navigation starts.
 */
export type SettingApply = "live" | "idle" | "restart";

export type SettingKind = "number" | "integer" | "boolean";

export type SettingValue = number | boolean;

export interface SettingGroup {
  id: string;
  /** Operator words; render verbatim. */
  label: string;
  description: string;
}

/**
 * One setting as the robot describes it. The robot owns the list, the words
 * and the limits — this console draws whatever it is sent — so a new setting
 * on the robot needs no console release.
 */
export interface SettingField {
  /** The key a change is sent under. */
  id: string;
  group: string;
  label: string;
  description: string;
  kind: SettingKind;
  unit: string | null;
  min: number | null;
  max: number | null;
  step: number | null;
  apply: SettingApply;
  /**
   * The value to show: the one in force, or for a `restart` setting the one
   * the next start loads. Null when the robot cannot tell.
   */
  value: SettingValue | null;
  /** The running navigation's value; null while it is not running. */
  current: SettingValue | null;
  /** The robot's default. Null when the robot cannot read its defaults. */
  default: SettingValue | null;
  /** Whether the robot keeps a value of its own instead of the default. */
  modified: boolean;
  /** A `restart` setting changed but not yet in force. */
  pending_restart: boolean;
}

export interface NodeSettings {
  /**
   * Whether navigation is running. When false the values are the saved ones,
   * and a change is saved for the next start.
   */
  live_available: boolean;
  groups: SettingGroup[];
  fields: SettingField[];
}

const ValueSchema = z.union([z.number(), z.boolean()]);

const SettingFieldSchema: z.ZodType<SettingField> = z.object({
  id: z.string(),
  group: z.string(),
  label: z.string(),
  description: z.string(),
  kind: z.enum(["number", "integer", "boolean"]),
  unit: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  step: z.number().nullable(),
  apply: z.enum(["live", "idle", "restart"]),
  value: ValueSchema.nullable(),
  current: ValueSchema.nullable(),
  default: ValueSchema.nullable(),
  modified: z.boolean(),
  pending_restart: z.boolean(),
});

const SettingGroupSchema: z.ZodType<SettingGroup> = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

/**
 * A field this console cannot draw (a kind or an `apply` added on the robot
 * after this build) is dropped rather than failing the page, as the step
 * catalogue does: the other settings stay editable, and the robot still
 * validates every change.
 */
export const NodeSettingsSchema: z.ZodType<NodeSettings> = z
  .object({
    live_available: z.boolean(),
    groups: z.array(SettingGroupSchema),
    fields: z.array(z.unknown()),
  })
  .transform(({ live_available, groups, fields }) => ({
    live_available,
    groups,
    fields: fields.flatMap((raw) => {
      const parsed = SettingFieldSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  }));

function settingsPath(page: SettingsPageId): string {
  return `/api/v1/settings/${page}`;
}

/**
 * A page's settings. Slow when navigation is not running: the robot waits a
 * couple of seconds for the node before answering with the saved values.
 */
export function fetchSettings(
  page: SettingsPageId,
  signal?: AbortSignal,
): Promise<NodeSettings> {
  return requestJson<NodeSettings>(apiUrl(settingsPath(page)), {
    signal,
    schema: NodeSettingsSchema,
  });
}

/**
 * Change some settings; only the ones being changed. Answers the new state.
 * Refusals are sentences: a value out of its limits or at odds with another
 * setting (400), a setting that can only change while the robot is stopped
 * (409 `controller_busy`), another change in flight (409 `settings_busy`).
 * Nothing is changed on any refusal.
 */
export function updateSettings(
  page: SettingsPageId,
  values: Record<string, SettingValue>,
): Promise<NodeSettings> {
  return requestJson<NodeSettings>(apiUrl(settingsPath(page)), {
    method: "PUT",
    body: JSON.stringify({ values }),
    schema: NodeSettingsSchema,
  });
}

/** Back to the robot's defaults: the given settings, or all of them. */
export function resetSettings(page: SettingsPageId, ids?: string[]): Promise<NodeSettings> {
  const query = ids?.length
    ? `?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`
    : "";
  return requestJson<NodeSettings>(apiUrl(`${settingsPath(page)}${query}`), {
    method: "DELETE",
    schema: NodeSettingsSchema,
  });
}
