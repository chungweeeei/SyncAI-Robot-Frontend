# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Operator console (web frontend) for a quadruped robot — the UI a human uses to
watch telemetry, drive the robot, and manage maps and tasks. It talks to a
separate robot backend over REST and WebSocket.

## Commands

```bash
npm ci             # install (lockfile is authoritative); Node >= 22
npm run dev        # dev server + HMR on http://localhost:3001
npm run build      # production build (also runs the TypeScript check)
npm start          # serve the production build on 3001
npm run lint       # eslint (flat config; components/ui/** is ignored)
```

`npm run build` is the real gate — there is no separate `tsc` script, so type
errors only surface there. **There is no test setup** (no runner, no config, no
`*.test.*` files), so there is no command for running a single test; add one
here if a runner is introduced.

The source was ported in from `src/syncai_frontend` of the
`SyncAI-Robot-Workspace` repo, which still holds the ROS side (including
`scripts/urdf2glb.py`, which bakes `public/models/g23.glb`).

## Tech stack

The stack as built. Correct this section if a choice changes.

- **Next.js (App Router) + React** — `app/` holds route shells only ("chrome"),
  with a component owning each page's real content.
- **shadcn/ui** — the component primitives live under `components/ui/` and are
  owned by this repo (copied in, then edited), not consumed as an external
  dependency.
- **TanStack Query (react-query)** — every backend read is wrapped in a custom
  hook under `hooks/`, one hook per backend interaction. Components call hooks;
  they do not fetch.
- **TypeScript** throughout.

### Layering

`app/` (route shells) → `components/` (feature folders + `ui/` primitives) →
`hooks/` (one per backend interaction) → `lib/` (typed fetchers, config, query
keys, WebSocket clients).

Keep the direction of that arrow: a component should not reach past `hooks/`
into a fetcher, and `lib/` should not import from `components/`.

### Backend addressing

Never hardcode a backend host. Route every REST and WebSocket path through
helpers in `lib/api/config.ts` (e.g. `apiUrl()` / `wsUrl()`) that default to the
page's own hostname and are overridable via `NEXT_PUBLIC_*` env vars, so the
same build works on a laptop and on the robot.

### Query keys

Centralise every TanStack Query key in `lib/api/query-keys.ts` rather than
inlining it in the hook. Cache *sharing* between screens (two views deliberately
reading the same key so an edit on one is already current on the other) is only
reviewable if the keys sit together in one file.

### Realtime

High-rate streams (telemetry, point cloud, teleop) do not belong in TanStack
Query. Keep them on plain WebSocket clients in `lib/ros/`, and for anything
rendering at frame rate, write into the renderer's buffers directly instead of
through React state.

## Local skills

Two project-scoped skills live in `.claude/skills/` and are expected to be used
when writing UI code here:

- `frontend-a11y` — accessibility patterns for React/Next.js. Consult before
  building any interactive component or form (label/`id` pairing, ARIA,
  keyboard navigation, focus management).
- `frontend-design` — visual design direction. Consult when creating new UI or
  reshaping existing UI; the brief explicitly rejects templated/default-looking
  output.

## Conventions

- Next.js moves fast and may differ from training data — when a Next.js API is
  involved, check `node_modules/next/dist/docs/` (the pinned 16.2.10 docs)
  rather than writing from memory.

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
the imperative mood, no trailing period. One logical change per commit.

**Pull requests** — target `dev` (except `hotfix/`, which targets `main`).
Rebase or merge `dev` in before requesting review so the PR is conflict-free,
and make sure lint, types, and tests pass. Releases are a `dev` → `main` PR.
