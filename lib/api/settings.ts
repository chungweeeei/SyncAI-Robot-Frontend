import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";

/**
 * How a change takes effect, as the robot reads its own controller: `live` at
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

export interface ControllerSettings {
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
export const ControllerSettingsSchema: z.ZodType<ControllerSettings> = z
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

const URL_PATH = "/api/v1/settings/controller";

/**
 * The controller's settings. Slow when navigation is not running: the robot
 * waits a couple of seconds for it before answering with the saved values.
 */
export function fetchControllerSettings(signal?: AbortSignal): Promise<ControllerSettings> {
  return requestJson<ControllerSettings>(apiUrl(URL_PATH), {
    signal,
    schema: ControllerSettingsSchema,
  });
}

/**
 * Change some settings; only the ones being changed. Answers the new state.
 * Refusals are sentences: a value out of its limits or at odds with another
 * setting (400), a setting that can only change while the robot is stopped
 * (409 `controller_busy`), another change in flight (409 `settings_busy`).
 * Nothing is changed on any refusal.
 */
export function updateControllerSettings(
  values: Record<string, SettingValue>,
): Promise<ControllerSettings> {
  return requestJson<ControllerSettings>(apiUrl(URL_PATH), {
    method: "PUT",
    body: JSON.stringify({ values }),
    schema: ControllerSettingsSchema,
  });
}

/** Back to the robot's defaults: the given settings, or all of them. */
export function resetControllerSettings(ids?: string[]): Promise<ControllerSettings> {
  const query = ids?.length
    ? `?${ids.map((id) => `id=${encodeURIComponent(id)}`).join("&")}`
    : "";
  return requestJson<ControllerSettings>(apiUrl(`${URL_PATH}${query}`), {
    method: "DELETE",
    schema: ControllerSettingsSchema,
  });
}
