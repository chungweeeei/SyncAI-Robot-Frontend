// The steps the robot can take, as the task editor builds its menus and forms
// from them.
//
// What the robot can do is the backend's to say: GET /api/v1/task_steps
// answers with every type, its operator label and hint, whether it occupies
// the robot's body (the group rule), and its parameters as a short list of
// field kinds the console knows how to draw. useStepCatalogue reads it, and
// falls back to LOCAL_STEP_CATALOGUE while it loads and on a robot from
// before the endpoint; nothing in components/ imports either directly.
//
// A closed set of field kinds rather than JSON Schema: each kind is drawn
// with the care the hand-built rows had (a counter near a text limit, no
// type="number" erasing half-typed input), and the backend still validates,
// its refusals rendered verbatim.

import { z } from "zod";

import type { StepType } from "@/lib/api/task";
import {
  DEFAULT_STEP_LIMITS,
  INSPECTION_OPTIONS,
  SPEAK_REPEAT_MAX,
  SPEAK_TEXT_MAX,
  STEP_TYPES,
  WAIT_SECONDS_MAX,
  type StepLimits,
} from "@/lib/task/step";

/**
 * A waypoint on the job's map. On the wire it is not one key: it spreads into
 * `x / y / theta / z` and the template's `vertex_id`. A step with one is a
 * stop in the editor; see isStopSpec.
 */
export interface WaypointField {
  kind: "waypoint";
  key: string;
  label: string;
  /** "charger": only charging waypoints are offered. */
  filter?: "charger" | null;
}

export interface TextField {
  kind: "text";
  key: string;
  label: string;
  max_length: number;
  placeholder?: string | null;
}

export interface IntegerField {
  kind: "integer";
  key: string;
  label: string;
  min: number;
  max: number;
  /** The count a new step starts at; sent only when it differs. */
  default: number;
  /** What the count counts, after the field: "times". */
  unit?: string | null;
}

export interface NumberField {
  kind: "number";
  key: string;
  label: string;
  min: number;
  /** True when `min` itself is refused: a 0 s wait waits for nothing. */
  min_exclusive?: boolean;
  max: number;
  unit?: string | null;
  placeholder?: string | null;
}

/** Demo branch only, for DEMO: one of a fixed set of values, drawn as a select. */
export interface ChoiceField {
  kind: "choice";
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export type StepParamField =
  | WaypointField
  | TextField
  | IntegerField
  | NumberField
  | ChoiceField;

export interface StepSpec {
  type: StepType;
  /** Operator words, as the add menus and each row name the step. */
  label: string;
  hint: string;
  /**
   * Moves the robot's body (walks, stands, lies). A group runs at most one,
   * which is how the editor decides what may start together.
   */
  occupies_body: boolean;
  /**
   * Offered on the walk to a stop, started with it. Never a body step, and
   * not a Wait either: in the walk's group it only stretches the walk.
   */
  while_walking: boolean;
  params: StepParamField[];
}

export interface StepCatalogue {
  steps: StepSpec[];
}

const WaypointFieldSchema: z.ZodType<WaypointField> = z.object({
  kind: z.literal("waypoint"),
  key: z.string(),
  label: z.string(),
  filter: z.literal("charger").nullish(),
});

const TextFieldSchema: z.ZodType<TextField> = z.object({
  kind: z.literal("text"),
  key: z.string(),
  label: z.string(),
  max_length: z.number(),
  placeholder: z.string().nullish(),
});

const IntegerFieldSchema: z.ZodType<IntegerField> = z.object({
  kind: z.literal("integer"),
  key: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  default: z.number(),
  unit: z.string().nullish(),
});

const NumberFieldSchema: z.ZodType<NumberField> = z.object({
  kind: z.literal("number"),
  key: z.string(),
  label: z.string(),
  min: z.number(),
  min_exclusive: z.boolean().optional(),
  max: z.number(),
  unit: z.string().nullish(),
  placeholder: z.string().nullish(),
});

const ChoiceFieldSchema: z.ZodType<ChoiceField> = z.object({
  kind: z.literal("choice"),
  key: z.string(),
  label: z.string(),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
});

const StepSpecSchema: z.ZodType<StepSpec> = z.object({
  type: z.enum(["MOVE", "DOCK", "SPEAK", "WAIT", "STANDUP", "LIEDOWN", "DEMO"]),
  label: z.string(),
  hint: z.string(),
  occupies_body: z.boolean(),
  while_walking: z.boolean(),
  params: z.array(
    z.union([
      WaypointFieldSchema,
      TextFieldSchema,
      IntegerFieldSchema,
      NumberFieldSchema,
      ChoiceFieldSchema,
    ]),
  ),
});

/**
 * GET /api/v1/task_steps. A step this console cannot draw — a type it does
 * not know, or a field of a kind it has no control for — is left out of the
 * menus rather than failing the whole answer: a robot updated before its
 * console must cost the new step, not the editor. Everything else is checked
 * as strictly as any read.
 */
export const StepCatalogueSchema: z.ZodType<StepCatalogue> = z
  .object({ steps: z.array(z.unknown()) })
  .transform(({ steps }) => ({
    steps: steps.flatMap((raw) => {
      const parsed = StepSpecSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }),
  }));

function spec(
  type: StepType,
  occupiesBody: boolean,
  params: StepParamField[],
  whileWalking = false,
): StepSpec {
  const words = STEP_TYPES.find((each) => each.value === type);
  return {
    type,
    label: words?.label ?? type,
    hint: words?.hint ?? "",
    occupies_body: occupiesBody,
    while_walking: whileWalking,
    params,
  };
}

/**
 * Today's six steps in the catalogue's shape. The limits are step.ts's, which
 * mirror the backend's validators; Speak's voice and speed are left out, as
 * the backend defaults them and the editor never sent them.
 */
export const LOCAL_STEP_CATALOGUE: StepCatalogue = {
  steps: [
    spec("MOVE", true, [{ kind: "waypoint", key: "target", label: "Waypoint" }]),
    spec("DOCK", true, [
      { kind: "waypoint", key: "target", label: "Charger", filter: "charger" },
    ]),
    spec("SPEAK", false, [
      {
        kind: "text",
        key: "text",
        label: "Say",
        max_length: SPEAK_TEXT_MAX,
        placeholder: "Delivery arrived — please take your items.",
      },
      {
        kind: "integer",
        key: "repeat",
        label: "Times",
        min: 1,
        max: SPEAK_REPEAT_MAX,
        default: 1,
      },
    ], true),
    spec("WAIT", false, [
      {
        kind: "number",
        key: "seconds",
        label: "Duration",
        min: 0,
        min_exclusive: true,
        max: WAIT_SECONDS_MAX,
        unit: "seconds",
        placeholder: "10",
      },
    ]),
    spec("STANDUP", true, []),
    spec("LIEDOWN", true, []),
    spec("DEMO", false, [
      {
        kind: "choice",
        key: "inspection",
        label: "Result",
        options: INSPECTION_OPTIONS.map((option) => ({ ...option })),
      },
    ]),
  ],
};

export function stepSpec(catalogue: StepCatalogue, type: StepType): StepSpec | null {
  return catalogue.steps.find((each) => each.type === type) ?? null;
}

/** A step set by a waypoint is a stop: the editor gives it a card of its own. */
export function isStopSpec(spec: StepSpec): boolean {
  return spec.params.some((field) => field.kind === "waypoint");
}

/** The steps done at or on the way to a stop, in catalogue order. */
export function actionSpecs(catalogue: StepCatalogue): StepSpec[] {
  return catalogue.steps.filter((each) => !isStopSpec(each));
}

/** The stops, in catalogue order: what a row of the map can be. */
export function stopSpecs(catalogue: StepCatalogue): StepSpec[] {
  return catalogue.steps.filter(isStopSpec);
}

/**
 * What may be done while walking to a stop, as the robot says: never a body
 * step, which the walk already occupies, whatever an answer claims.
 */
export function transitSpecs(catalogue: StepCatalogue): StepSpec[] {
  return actionSpecs(catalogue).filter((each) => each.while_walking && !each.occupies_body);
}

/**
 * The bounds a draft is checked against, from the robot's own fields: Speak's
 * text and count, Wait's duration. A field the catalogue leaves out keeps the
 * local bound.
 */
export function stepLimits(catalogue: StepCatalogue): StepLimits {
  const field = (type: StepType, key: string) =>
    stepSpec(catalogue, type)?.params.find((each) => each.key === key);
  const text = field("SPEAK", "text");
  const repeat = field("SPEAK", "repeat");
  const seconds = field("WAIT", "seconds");
  return {
    speakTextMax:
      text?.kind === "text" ? text.max_length : DEFAULT_STEP_LIMITS.speakTextMax,
    speakRepeatMax:
      repeat?.kind === "integer" ? repeat.max : DEFAULT_STEP_LIMITS.speakRepeatMax,
    waitSecondsMax:
      seconds?.kind === "number" ? seconds.max : DEFAULT_STEP_LIMITS.waitSecondsMax,
  };
}
