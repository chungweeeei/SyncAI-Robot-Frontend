import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The layering rule from CLAUDE.md, as something that fails a build rather than
 * something a reader has to remember:
 *
 *   app/ → components/ → hooks/ → lib/
 *
 * Every hop below was violated at some point before these blocks existed —
 * three hooks reached up into components/console/ for the shared robot-state
 * context, lib/ros/ reached up into a joystick hook for the type of its own
 * wire payload, and a dozen components imported constants and helpers straight
 * out of the REST clients. None of it was noticed, because prose in a markdown
 * file is not a check. The fix in each case was to move the thing being
 * imported down, never to add an exception here.
 */
const restrict = (patterns) => ({
  "@typescript-eslint/no-restricted-imports": ["error", { patterns }],
});

/**
 * For the two lower hops, type imports are restricted too, deliberately. The
 * lib/ros violation was type-only, erased at compile time and free at runtime,
 * and it was still the wrong direction: a payload type that `lib/` needs
 * belongs in `lib/types/`. "It is only a type" is how the arrow gets bent.
 */
const upward = (group, message) => [{ group, message }];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // shadcn-generated files
    "components/ui/**",
    "hooks/use-mobile.ts",
  ]),
  {
    files: ["hooks/**/*.{ts,tsx}"],
    rules: restrict(
      upward(
        ["@/components/**", "@/app/**"],
        "hooks/ sits below components/ (see CLAUDE.md > Layering). If a hook needs " +
          "something that lives in a component file, move that thing into hooks/ or " +
          "lib/ — components/console/robot-state-provider.tsx and " +
          "hooks/use-console-robot-state.ts are the worked example of that split.",
      ),
    ),
  },
  {
    files: ["lib/**/*.{ts,tsx}"],
    rules: restrict(
      upward(
        ["@/components/**", "@/hooks/**", "@/app/**"],
        "lib/ is the bottom layer (see CLAUDE.md > Layering) and imports from no " +
          "other. A shared type belongs in lib/types/; shared logic belongs in the " +
          "lib/ module that owns it. This applies to `import type` as well.",
      ),
    ),
  },
  {
    // The one hop where `import type` is fine: a component renders the wire
    // shapes, so it legitimately names them. What it may not do is reach past
    // hooks/ for a *value* — a fetcher, a query key, or anything else that runs.
    // lib/api/config is exempt because it is the addressing helper rather than a
    // client: apiUrl() is what absolutises a map thumbnail's <img src>, and
    // CLAUDE.md requires every URL to go through it.
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    rules: restrict([
      {
        group: ["@/lib/api/*", "!@/lib/api/config"],
        allowTypeImports: true,
        message:
          "components/ and app/ reach the backend through hooks/, never through a " +
          "REST client (see CLAUDE.md > Layering). `import type` from lib/api is " +
          "fine. For a value, add or extend a hook; if what you need is a pure " +
          "constant or helper rather than a request, it belongs in a lib/ module " +
          "that is not lib/api — lib/map/name.ts, lib/recording/name.ts, " +
          "lib/task/template.ts and lib/angle.ts were all carved out for exactly " +
          "that reason.",
      },
    ]),
  },
]);

export default eslintConfig;
