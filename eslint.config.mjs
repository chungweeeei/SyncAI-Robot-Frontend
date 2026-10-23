import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The layering rule from CLAUDE.md (app/ → components/ → hooks/ → lib/) as a
 * lint failure, because every hop was broken unnoticed while it was only prose.
 * Fix a break by moving the imported thing down, not by adding an exception.
 */
const restrict = (patterns) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    { patterns: [...patterns, ...noParentRelative] },
  ],
});

/**
 * Every rule below matches `@/…` paths, so `../../lib/api/map` would walk
 * straight past them. A parent-relative import is refused outright instead —
 * nothing in the source uses one — which keeps every cross-folder import in
 * the one spelling the layering rules can see. Part of every block, since a
 * later block's patterns replace an earlier one's rather than adding to them.
 */
const noParentRelative = [
  {
    group: ["../*", "../**"],
    message:
      "Import across folders through the `@/` alias, never a `../` path: the " +
      "layering rules (see CLAUDE.md > Layering) only see `@/` imports.",
  },
];

/**
 * The two lower hops restrict type imports too: a type `lib/` needs belongs in
 * `lib/types/`, and "it is only a type" is how the arrow gets bent.
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
    files: ["{app,components,hooks,lib}/**/*.{ts,tsx}"],
    rules: restrict([]),
  },
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
    // `import type` is fine here: a component renders the wire shapes. A *value*
    // from lib/api is not. lib/api/config is exempt because apiUrl() is the
    // addressing helper every URL, <img src> included, must go through.
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
