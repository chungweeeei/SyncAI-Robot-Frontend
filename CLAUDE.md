# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Operator console (web frontend) for a quadruped robot — the UI a human uses to
watch telemetry, drive the robot, and manage maps, recordings and tasks. It is
a browser client of `syncai_backend` (FastAPI, port **3000**) and nothing else:
every REST call and WebSocket stream goes to that one process. `README.md`
holds the per-route description, the GLB/URDF invariants and the port notes;
this file holds the rules for working in the code.

## Commands

```bash
npm ci             # install (lockfile is authoritative); Node >= 22
npm run dev        # dev server + HMR on http://localhost:3001
npm run build      # production build; the real gate (runs the type check)
npm start          # serve the production build on 3001
npm run lint       # eslint flat config; also enforces the layering rule below
npx tsc --noEmit   # type check alone, faster than a full build
npm test           # vitest, unit tests only (vitest.config.mts)
npm run test:watch # the same, watching
npm run test:e2e   # playwright; builds and starts the app itself

cp .env.example .env                 # compose knobs; nothing else reads it
docker compose build frontend-build  # the image (behind the `build` profile)
docker compose up -d frontend        # serve it on 3001
```

Run one unit file with `npx vitest run lib/map/view.test.ts`, one e2e test with
`npx playwright test -g "cancels that run"`, and add `--ui` to either for the
interactive runner.

`.github/workflows/ci.yml` runs all of it on every push and PR to `main` and
`dev`, in two parallel jobs: `check` (lint, `tsc`, unit tests, build) and `e2e`
(playwright, which produces its own production build). Node is pinned to 22.
A failing e2e run uploads its traces as an artifact.

`.github/workflows/release.yml` builds the container image on two native
runners (arm64 for the Jetson, amd64) and publishes one multi-platform
manifest to `ghcr.io/chungweeeei/syncai-robot-frontend`: every push to `main`
moves the `main` tag, a `v*` tag on `main` publishes the semver tags and
`latest`. It passes no `NEXT_PUBLIC_*` build args on purpose, so the image
works on any robot. It is separate from CI because a container build is
minutes long and only matters after the gate has passed. Like every workflow
here it first runs once it is on `main`, and `main` is still at the initial
commit: the first `dev` → `main` release PR is what starts publishing.

`.github/workflows/claude-review.yml` reviews each PR against the conventions
CI cannot check — it reads this file and `.claude/skills/` from the checkout,
which is what makes them enforceable rather than merely written down. It runs
only once the workflow reaches `main`, the default branch; see the
`github-flow` skill for why.

Ports: the console listens on 3001 and expects the backend on 3000 of the same
host, in `npm start` and in the container alike. In `docker-compose.yaml` the
`frontend` run service has no `build:` block, so it can run either the locally
built tag or the GHCR one, chosen in `.env`. `NEXT_PUBLIC_*` are build args,
not runtime environment, because Next inlines them at build time; the README's
"Container image" section has the details. The robot sessions still run
`npm run dev` today.

The source was ported in from `src/syncai_frontend` of the
`SyncAI-Robot-Workspace` repo, which still holds the ROS side (including
`scripts/urdf2glb.py`, which bakes `public/models/g23.glb`).

## Tests

Unit tests sit next to what they test (`lib/map/view.test.ts`), e2e tests live
in `e2e/`. The split is by what they can actually prove, not by size:

- **Vitest** covers `lib/`, which after the scene and draw extractions is where
  nearly all the logic is. Prefer a test that states a *rule* the code has to
  keep — `normalizeTheta` never returns -180 because the backend rejects it,
  a stamp clips instead of wrapping to the next row, an added backend field
  must not break a schema — over one that restates the implementation.
- **Playwright** covers the flows where a button does something to a real
  machine. Every test installs its own fake backend (`e2e/backend.ts`), so a
  run needs no robot and can hold states a robot will not: unlocalized,
  mid-conversion, a run started by another console. Assert both halves — what
  the screen says *and* what the console sent — because a build that posts to
  the wrong endpoint passes a screen-only test.
- The e2e suite fails on any console error the page logs, which is what catches
  a hydration mismatch or a thrown render. WebSocket noise is filtered, since
  there is no robot to connect to.
- What neither can prove is that the backend really answers in these shapes.
  The fixtures are written from the same interfaces the zod schemas mirror, so
  a drifted fixture fails at the schema boundary rather than passing quietly.

## Tech stack

The stack as built. Correct this section if a choice changes.

- **Next.js 16.2.10 (App Router) + React 19.** Every page is `"use client"`;
  the root layout is the only server component that matters.
- **shadcn/ui on `@base-ui/react`** (`components.json`, style `base-nova`),
  Tailwind 4, `lucide-react` icons, `next-themes` for light/dark. The primitives
  under `components/ui/` are owned by this repo (copied in, then edited).
- **TanStack Query v5** for every REST read. One `QueryClient` in
  `components/query-provider.tsx` with `retry: false` and
  `refetchOnWindowFocus: false` — poll intervals are the retry policy.
- **Raw three.js** (no react-three-fiber) for the 3D viewport, and a 2D
  `<canvas>` for the gridmap editor. Both are hand-rolled render loops.
- **WebRTC (WHEP) in `lib/video/`** reaches the operator as the masthead's
  camera window (`useCameraStream` → `components/console/camera-window.tsx`), a
  movable, resizable panel any screen can open. The `/webrtc-test` bench is the
  other consumer and the only one that exercises WHIP: it renders in every
  build — the robot runs a production one — and is kept off an operator's path
  by being unlisted in the nav rail rather than by a 404.
- **@dnd-kit** (`core` + `sortable`) for the task editor's drag-to-reorder
  step list. Everything else that drags (the gridmap editor, the camera window,
  the thumbstick) is hand-rolled pointer capture; a sortable list is the one
  place a library earned its keep, because it brings the keyboard path, the
  screen-reader announcements and the auto-scroll that a hand-rolled one
  would have to rebuild.
- **zod** for runtime validation of every backend read (see Data layer).
- **Vitest** for unit tests, **Playwright** for e2e (see Tests). No
  `@vitejs/plugin-react`: esbuild already takes the JSX runtime from tsconfig,
  and the plugin drags in a Babel 8 peer that collides with shadcn's Babel 7.
- **TypeScript** throughout, `strict: true`.

## Directory map

```
app/            route shells; the real content belongs to a component (see deviations)
components/
  console/      shell: nav rail, status strip, the two layout-level providers
                (their contexts live in hooks/use-console-*.ts — see Layering),
                and the strip's disclosures: the drive panel and camera window
                every screen can open
  dashboard/    3D viewport (pointcloud-canvas), telemetry rail, driving controls
  mapping/      mode switch, save-map and reset-run controls
  maps/         map library cards and the gridmap editor (grid-canvas)
  recordings/   bag recorder and list
  tasks/        template library, step composer, dispatch, schedules
  history/      finished-job list: filters, cursor paging, per-run step detail
  settings/     appearance and Wi-Fi
  webrtc/       WHIP/WHEP bench (unlisted developer route — see deviations)
  ui/           shadcn primitives (lint-ignored)
hooks/          one hook per backend interaction; the only place components get data.
                A few talk to no backend at all (use-joystick, use-step-drafts,
                use-camera-clip, use-mobile): React glue over a lib/ module or a
                browser API, never a second home for the logic itself
lib/
  api/          typed fetchers per backend router, config.ts, http.ts, query-keys.ts
                (requests only — mirrored validation rules live with their domain)
  ros/          WebSocket clients + frame decoders (telemetry, point cloud, teleop)
  map/          gridmap maths: view transforms, patches, session, vertex helpers,
                name rule, the 2D drawing (draw.ts) and the editor's vocabulary
  scene/        three.js scene building for the 3D viewport: theme, markers,
                vertex layer, path ribbon, camera policy, picking, robot mesh
  theme/        the signal hues both canvases draw with
  task/         step, schedule and history domain helpers, template name limit
  recording/    bag size/duration formatting and the bag name rule
  robot/        G23 joint table (URDF link names ↔ GLB node names)
  video/        WHIP/WHEP signalling, and the camera window's clip capture
                (container pick, filename rule, the recorder wrapper)
  types/        shared wire types (map, robot, pointcloud, stream)
  angle.ts      normalizeTheta — the degree fold every heading goes through
  download.ts   downloadBlob — hands a file to the operator's own machine
```

## Layering

`app/` (route shells) → `components/` (feature folders + `ui/` primitives) →
`hooks/` (one per backend interaction) → `lib/` (typed fetchers, config, query
keys, WebSocket clients).

Rules for new code:

- A component gets backend data and performs backend writes **only through a
  hook**. Importing a *value* from `lib/api/*` into `components/` or `app/` is a
  layering break; `import type` is fine, and `lib/api/config` is exempt because
  `apiUrl()` is the addressing helper every URL has to go through, including an
  `<img src>`.
- `hooks/` never imports from `components/` or `app/`, and `lib/` never imports
  from `hooks/`, `components/` or `app/`. For these two hops `import type` is
  restricted as well: a type that `lib/` needs belongs in `lib/types/`, and "it
  is only a type" is how the arrow gets bent.
- **All three hops are enforced by eslint** (`no-restricted-imports` blocks in
  `eslint.config.mjs`), so a break fails `npm run lint` with a message naming
  where the thing being imported should live instead.
- A pure constant or helper that a component needs does **not** belong in a
  fetcher module just because the backend also enforces it. `lib/map/name.ts`,
  `lib/recording/name.ts`, `lib/task/template.ts` and `lib/angle.ts` were carved
  out of `lib/api/*` for exactly this reason; put the next one beside them.
- A shared React context is split across the boundary rather than exempted from
  it: the context object and its `useConsole*` accessor go in `hooks/`, the
  provider component stays in `components/console/`. See
  `hooks/use-console-robot-state.ts` beside
  `components/console/robot-state-provider.tsx`.
- `app/*/page.tsx` is chrome: it reads a provider, picks a component, and
  renders it. State machines, dialogs and fetcher calls go in `components/`.
- Pure, React-free logic (maths, drawing, scene construction) goes in `lib/`,
  even when only one component uses it.

### Where the code currently deviates

These are known debt, not precedent. Do not copy them into new code; when you
touch one, prefer moving it toward the rule.

- **The WebRTC bench has no hook layer.** `hooks/use-camera-stream.ts` now owns
  the WHEP session for the operator-facing camera window, which is the debt
  this entry used to describe. What is left is `components/webrtc/webrtc-bench.tsx`,
  which still drives its own sessions and polls their stats with three
  `setInterval`s — deliberately, because what that page exists to show *is* the
  negotiation, and a hook that hides it would leave the bench with nothing to
  report. The route is unlisted but reachable in every build, since testing the
  video path means testing it on the robot.
- **One server read outside TanStack Query**, on purpose: `hooks/use-map-grid.ts`
  owns a mutable `GridSession` holding a cell buffer and a canvas that must be
  disposed, which is not something a structurally-shared cache should hand
  around. Everything else that reads the backend is a query.
- **The two canvases are still the biggest components** (~1380 and ~825
  lines), but what is left is React: refs, effects, the frame loop and the
  pointer state machines. The scene builders and the 2D drawing moved to
  `lib/scene/` and `lib/map/draw.ts`. The gesture reducers are the next thing
  that could follow them.

## Data layer conventions

- **Fetchers** live in `lib/api/<router>.ts` and go through `lib/api/http.ts`.
  There are exactly two doors: `requestJson` for a JSON answer, `requestRaw`
  for one that is not (the gridmap image, the map point cloud). Nothing under
  `lib/api/` or `lib/ros/` calls `fetch` itself, so the way a refusal becomes
  an `Error` is written once. `lib/video/` is the exception and stays one: WHIP
  and WHEP exchange SDP and read a `Location` header, which is not this
  vocabulary. The clip that window saves is the one artifact this console
  produces that the backend never sees at all, which is why it has no fetcher,
  no query key and nothing to invalidate.
- **A refusal is the backend's own sentence.** `errorBody` unwraps FastAPI's
  `{detail}` once, because a Response body can only be read once and two
  endpoints carry a `code` beside it. Those sentences are written for operators
  and every caller renders `error.message` verbatim — do not wrap or rephrase
  them. An endpoint whose refusal the UI *branches* on passes `mapError` to
  turn that code into a typed error; everything else wants the plain one.
- **Writes are `useMutation` hooks**, one per backend write, grouped by router
  (`hooks/use-map-actions.ts`, `use-mapping-run.ts`, `use-recorder.ts`,
  `use-cancel-task.ts`, and the write halves of the list hooks). The hook-level
  `onSuccess` owns the cache consequences — every `invalidateQueries`,
  `setQueryData` and `removeQueries` the response implies — and is not awaited,
  so a card that unmounts on refetch still gets its own callback. UI reactions
  (close a dialog, hand the backend's sentence up) go in the per-call
  `mutate(vars, { onSuccess })`, which only fires while the caller is mounted.
  Components read `isPending` / `error?.message` / `data` off the mutation and
  call `reset()` where they used to clear a local error. The list hooks
  (`use-map-vertices`, `use-task-templates`, `use-schedules`) keep their
  `busy` / `error` / `create` / `remove` surface, folded from their mutations
  by `lib/api/mutation-state.ts`.
- **Command hooks are mutations too**, but they answer to the robot rather
  than to the cache: `use-goal-task`, `use-posture`, `use-task-dispatch`,
  `use-initial-pose`, `use-locomotion`, `use-mode-switch`, `use-wifi-connect`.
  They invalidate nothing — there is no cached resource a motion key or a pose
  estimate makes stale — and instead compose a *reader* that reports what the
  robot did with the command: `useTaskTracker` for anything dispatched as a
  Temporal task, and the console's shared 1 Hz robot-state poll for the two
  that command the machine directly. Read the epistemics note in
  `use-locomotion.ts` before adding another: a request is not a reading, and
  which of the two a value is decides whether it may be shown as fact.
  `mutateAsync(…).catch(ignore)` is the house idiom for a handler wired
  straight to a button — the rejection is on the mutation, which is where the
  UI reads it.
- **Mutations use `networkMode: "always"`** (set in `components/query-provider.tsx`).
  The library default withholds a mutation while `navigator.onLine` is false
  and a withheld one never settles, which would leave `isPending` true with no
  error to explain it. That flag is the wrong question for a console talking to
  a robot on a LAN, and worst in the flow that drops the console's own link.
- **Reads are validated with zod.** Every response the backend composes is
  parsed through a schema passed as `requestJson`'s `schema` option; an
  unchecked `as T` was a promise about the backend rather than a check on it,
  and a renamed field arrived as `undefined` to surface pages later as a blank
  readout. A failure throws one sentence naming the endpoint and the field.
  Schemas live beside the interface they mirror and are annotated
  `z.ZodType<T>`, so a field added to the interface and forgotten in the schema
  does not compile. Unknown keys are stripped, so the backend adding a field is
  not a breaking change. Write bodies are not validated — their shape is closed
  by the request types — but a write's *echo* is, wherever it is spliced into
  the cache.
- **Query keys** all live in `lib/api/query-keys.ts`, one object, documented per
  key. Cache *sharing* is deliberate and visible there: `mapVertices(name)` is
  read by both the gridmap editor and the dashboard so a vertex moved on one is
  current on the other. Never inline a key.
- **Polling policy**: poll only while the server is changing something on its
  own, and let the status that triggered the poll switch it off (`useMaps`
  while `grid_status === "converting"`, `useRecordings` while a bag is live).
  Two console-wide polls are mounted once in `app/layout.tsx`:
  `RobotStateProvider` (1 Hz) and `ActiveTaskProvider` (2 s). Pages read those
  providers; they do not start their own `robotState` poll.
- **Invalidate across keys.** A rename or activate on a map changes task
  templates (`map_name`, `map_matches_active`); vertex CRUD changes map
  vertex counts and template resolution. Those are wired in the write hooks
  now — when adding a write, list every key its response affects in its
  `onSuccess`, not only the key it was fetched under.
- **Wire types** are split between `lib/types/` and the fetcher modules with no
  rule yet. Prefer `lib/types/` for anything more than one router shares.

## Realtime

High-rate streams do not belong in TanStack Query. They are plain WebSocket
clients in `lib/ros/`, one socket per stream and per consumer (no registry —
a second `useTelemetry()` on the same page opens a second socket). The split
into separate telemetry and point-cloud sockets is deliberate backpressure
design; read the comment in `lib/ros/socket.ts` before merging them.

As built:

- **Point cloud** (~10 Hz, binary) is written straight into preallocated
  three.js buffers via refs in `pointcloud-canvas.tsx`. This is the pattern to
  copy for anything at frame rate.
- **Teleop** (10 Hz outbound) reads a ref on an interval; React is not involved.
- **Telemetry** is split by rate in `hooks/use-telemetry.ts`, and the split is
  the rule to follow for anything added to that stream. Pose and joints are
  ~20 Hz each and are exposed as a `TelemetryFeed` of refs, drained once per
  drawn frame by `PointCloudCanvas`'s `telemetry` prop; they used to be state,
  which re-rendered a barely-memoised viewport subtree up to ~40 times a
  second. `path` stays state because it is ~0.333 Hz *and* has a consumer that
  branches on it outside the canvas. A value only a render loop reads does not
  belong in state; a value a component branches on does.
- **three.js teardown does not reach textures.** A material's `.map` is not
  disposed by disposing the material, so anything that loads one holds it and
  frees it by hand — see the ground texture in `pointcloud-canvas.tsx` and the
  vertex layer's badge textures. An async load also has to check the scene it
  was started for is still current before assigning.
- **A layer effect lists the scene's rebuild deps** (`meta`, `mapImageUrl`,
  `resolvedTheme`) even when it reads none of them, because a rebuild discards
  the scene it added to and the layer has to be re-added to the new one. Each
  such effect adds and removes its own object in one place; do not clean up the
  previous run at the top of the next one.
- **A clip's save deliberately outlives the component that started it.** The
  capture handle in `lib/video/clip.ts` is created in a click handler and owns
  its recorder, its chunks and its delivery, so closing the camera window — which
  unmounts it and closes the session — still writes the file. Moving the chunk
  buffer or the delivery into React state would lose a capture the moment the
  operator pressed Escape. Two consequences to keep: the unmount
  effect has empty deps and reads a ref, because a dep on the stream or on
  `capturing` would kill a live capture on the next render; and the finish path
  is once-only by flag, because `useCameraStream`'s cleanup runs first and ends
  the track, which has the browser flushing the recorder while the explicit
  stop is still on its way.

Both canvases read their signal hues from `lib/theme/signal.ts` — three.js
wants a number and a 2D context wants a string, and neither can read a CSS
custom property, so the values are transcribed from `app/globals.css` exactly
once. A token moved there is a two-file change, and the second file says so.

## Local skills

Project-scoped skills live in `.claude/skills/` and are expected to be used
when working here:

- `github-flow` — how work lands here: branching, splitting a change into
  commits, opening and stacking PRs with `gh`, watching CI, cutting a release
  tag, and deleting a branch safely. Also the gotchas that cost time once
  already, including why no workflow runs until it reaches `main`. Consult
  when committing, pushing, opening a PR, tagging, or debugging a failing
  check.
- `backend-endpoint` — the seven ordered steps for adding or changing a
  backend interaction, and the two mistakes that pass every automated gate
  (a write that misses a key its response affects; a zod schema written
  without the `z.ZodType<T>` annotation). Consult before touching `lib/api/`,
  a hook, or anything that talks to `syncai_backend`.
- `frontend-a11y` — accessibility patterns for React/Next.js. Consult before
  building any interactive component or form (label/`id` pairing, ARIA,
  keyboard navigation, focus management).
- `frontend-design` — visual design direction. Consult when creating new UI or
  reshaping existing UI; the brief explicitly rejects templated/default-looking
  output.
- `frontend-patterns` — React/Next.js component, state and render-performance
  patterns. Consult when reviewing or restructuring components.
- `grill-me` — user-invoked only (`/grill-me`): a relentless interview that
  sharpens a plan or design before it is built. Not for Claude to start on
  its own.

A personal `daily-report` skill lives at user level (`~/.claude/skills/`), not
in this repo: it summarises a day's commits, PRs and CI runs for whatever repo
it is run in, so it does not belong to any one of them.

## Conventions

- Next.js moves fast and may differ from training data — when a Next.js API is
  involved, check `node_modules/next/dist/docs/` (the pinned 16.2.10 docs)
  rather than writing from memory.
- **UI copy is written for FAEs and end customers, not for the people who
  built the stack.** On-screen text names what the operator sees and what to
  do about it; it never names an internal identifier (a ROS node or topic, a
  file on disk, a shell command, a vendor or algorithm name such as LIO, zstd,
  Temporal or the Tegra). Diagnostics of that kind were deliberately removed
  rather than demoted — do not reintroduce them, and do not put one in an
  error string because it would help you debug. The house words are: **floor
  plan** (not gridmap / 2D grid / occupancy grid), **scan** (not point cloud /
  "the cloud"), **waypoint** (not vertex / stop), **channel** (not topic),
  **recording** (not bag), **clip** for a video saved out of the camera window,
  **Mapping / Navigation** for the robot's MANUAL / AUTO modes, and **job** for
  a dispatched task. Backend sentences are still rendered verbatim; they are
  written for operators too.
- **A clip is not a recording.** A recording is the robot's bag, on the robot's
  disk, started and stopped over REST; a clip is a video of the camera window's
  picture, written by the browser onto the operator's own machine and never
  seen by the backend. They are different artifacts in different places, so they
  never share a word on screen — and, unusually for this codebase, not in the
  code either: `clip*` identifiers exist so a reader can tell which of the two a
  function is about without following it.
- **The code keeps the engineering names.** `vertex`, `grid`, `cloud`, `bag`
  and `topic` are the backend's vocabulary and stay in identifiers, types,
  query keys and routes. Only the strings a human reads are translated, which
  means `VertexPicker` renders the word "waypoint" on purpose — that gap is
  the convention, not a rename left half-done.
- Comments in this codebase explain *why* a choice was made (backpressure,
  poll economics, a backend quirk), not what the code does. Keep that standard;
  a decision without its reason will be undone by the next reader.
- Backend addressing: never hardcode a host. Every REST and WebSocket path goes
  through `apiUrl()` / `wsUrl()` in `lib/api/config.ts`, which default to the
  page's own hostname on port 3000 and are overridable via
  `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_BASE`. Even `<img src>` for map
  thumbnails is absolutised this way.

## Git workflow

Standard trunk-plus-branches flow. `main` is the release branch and always
deployable; `dev` is the integration branch that day-to-day work merges into.
Never commit directly to `main`, and avoid committing directly to `dev` —
cut a branch, open a PR.

**Branch naming** — `<type>/<short-kebab-description>`, branched from `dev`:

| Prefix | Use for |
| --- | --- |
| `feature/` | new functionality — `feature/teleop-joystick` |
| `bugfix/` | fixing a defect on `dev` — `bugfix/map-vertex-drift` |
| `hotfix/` | urgent fix branched from `main` and merged back to both `main` and `dev` |
| `refactor/` | restructuring with no behaviour change |
| `chore/` | deps, config, tooling, CI |
| `docs/` | documentation only |

Keep the description short and in English kebab-case. If the work has a ticket,
put the id first: `feature/SYNC-123-teleop-joystick`.

**Commits** — Conventional Commits: `<type>(<scope>): <subject>`, e.g.
`feat(dashboard): stream pointcloud into three.js buffers`. Types mirror the
branch prefixes (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`). Subject in
the imperative mood, no trailing period. One logical change per commit. The
specification itself is vendored at
`.github/prompt/copilot-commit-message-instructions.md` — it is there so the
editor's commit-message assistant writes the same shape a human here does;
this section is the house summary and wins where the two differ (the type list
above is shorter than the spec's on purpose).

**Pull requests** — target `dev` (except `hotfix/`, which targets `main`).
Rebase or merge `dev` in before requesting review so the PR is conflict-free,
and make sure lint, types, and tests pass. Releases are a `dev` → `main` PR; a
`vX.Y.Z` tag on the merge commit is what publishes the versioned image (see
`release.yml` above and the `github-flow` skill).
