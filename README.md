# SyncAI-Robot-Frontend

The operator console for one SyncAI robot (npm package name:
`syncai_frontend`). It is a browser client of `syncai_backend` and nothing
else: every byte it shows comes from that process's REST/WebSocket surface on
port **3000**, and it holds no robot state of its own beyond what a page needs
to render.

- **Next.js 16.2.10** (App Router) + **React 19**. The pinned Next has breaking
  changes relative to what models were trained on — read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code.
- **shadcn-style UI** (`components/ui/`) on `@base-ui/react`, Tailwind 4.
- **TanStack Query** for every REST read, each parsed through a **zod** schema.
- **Raw three.js** for the 3D view — no react-three-fiber.
- **WebRTC** (`lib/video/`) for the robot's camera, shown in a movable window
  any screen can open, which can also save a short video-only clip as a
  browser download — nothing is written on the robot.

Dev server, production server and the container all listen on **3001**
(`next dev -p 3001` / `next start -p 3001`, `PORT=3001` in the `Dockerfile`),
so the console and the backend can share a host without a proxy.

`CLAUDE.md` holds the rules for working in the code: layering, the data layer,
realtime streams, UI copy and git flow.

## Routes (`app/`)

What each route is for and the rules a reader cannot see by opening it.

| Route | What it is |
|---|---|
| `/` | Dashboard: the 3D viewport (live scan, the map's scan, robot mesh, planned route, waypoints, forbidden zones) with the pose in its corner, and the instrument rail — registered schedules (pause / delete), posture, locomotion, motors. No robot state, no panels. Forbidden zones are read once on open. While a job drives on the waypoints' map, waypoint edits are greyed; a goal is held while the active map's floor plan is rebuilding. |
| `/mapping` | Mapping mode. The rail switches `AUTO`/`MANUAL`; one strip over the viewport follows the robot's run state (`GET /api/v1/mapping`) — **Start mapping**, then a recording indicator beside **Save** and **New map**. Drive from the masthead's drive panel. Save asks for a name, then stays open as the receipt (the robot's sentence and the floor plan's progress). Everything that rebuilds or discards is confirmed — including a mode switch, which tears the stack down for ~30 s — and losing an unsaved run turns the confirm red. Start has no dialog. |
| `/maps` | Map library: a card per map with thumbnail and floor plan state. **Switch** re-points the localizer live and resets the pose to the new map's origin. Rename and Delete are greyed on the map in use (the backend refuses them); Edit is not. **Export** writes `<name>.zip`; **Import** takes one, and an existing name turns the confirm into a red **Replace**, since the backend overwrites. **A map a job drives on is read-only for the job's length** — the backend refuses with `task_running`; the console greys first, keyed on the job's `map_name`, and treats a loading or failing poll as locked. |
| `/maps/[name]/edit` | Floor plan editor. A **Draw** list (No type, Wall, Floor, Unknown, Waypoint, Forbidden zone) picks what a press does; it opens on No type, so a press only pans. The title renames in place, refused while the grid is dirty. **Use robot position** is offered only while localized on this map. Cells and forbidden zones save separately; removing a zone is sent at once. Unreadable zones grey that kind and leave cells editable, since saving an unread list would erase it. `?mode=vertex` and `?from=tasks` come from the task editor. During a job on this map, writes are held but edits stay. |
| `/recordings` | Start a recording on the robot, watch it grow, manage what is on disk. Idle asks for a name, channels (scanner, its motion sensor and the camera by default) and compression; live shows clock, bytes and channels. Which face shows comes from `GET /api/v1/recordings/active`, so a recording started elsewhere shows correctly. A bag that did not close cleanly is marked No index; a finished bag with zero messages is called out, because a mistyped channel is otherwise silent. The live one cannot be deleted. |
| `/settings` | Theme, waypoint labels, language, Wi-Fi, and a red **Restart** that rebuilds the robot's software in its current mode (warns when a job is running). Navigation only — Mapping's unsaved map lives in memory. The outcome is polled from `GET /api/v1/robot/restart`, not `/robot/state`, which keeps answering with the last frame. |
| `/tasks` | Saved jobs, schedules and any run in progress. **Run** dispatches, **Schedule** opens the trigger form, **Load** opens the editor (asking before it clears unsaved steps). A job for another map is marked and can't run or be scheduled; a Run sends its `map_name`, so a map switched since is refused (`map_mismatch`). Schedules are built from a Repeat picker plus a time — cron is never typed or shown, and a cron this console couldn't have written is shown verbatim. Next run is on the operator's clock. Not polled: it re-reads just after the soonest next run. |
| `/tasks/editor` | The step list under the job's name. **Save** updates or creates; **Delete** names any schedules of it. Rows fold to a one-line readback, and an unfinished one stays open. Reorder by drag or menu — the order shown is the order posted. A Move step picks a waypoint, never coordinates. The **Map** picker can target another map (switching clears picked waypoints). Unsaved work survives a reload and dies with the tab. |
| `/history` | Finished runs (`GET /api/v1/task_history`) under a dashboard of how the window's jobs ended (`.../stats`): counts, success rate, one bar. Filters (window, outcome, kind, template) live in the URL. Outcome narrows the list only, not the dashboard. Paging is forward cursors, ten per page, no total. Rows are titled by template, else kind, else job id. Not polled — refreshes when a run leaves the active-task poll. |
| `/drive` | Full-screen drive view for a phone — unlisted; the drive panel's ⤢ link opens it below `sm`. Two light 144 px overlay sticks in the bottom corners, no key hints; above them one pill with a back arrow, **Max speed** and a large arm switch. The translation stick drives one axis at a time (`lockToAxis`), since a thumb on glass has no detent for straight ahead. Arm state and limit are the view's own, and the strip hides the drive panel here, so there is never a second teleop channel. |
| `/webrtc-test` | The WHIP/WHEP bench — unlisted but in every build, because the robot runs a production build and is the only place the video path can be tested. |

**Nav rail.** From `lg` up it is labelled; the button in its top-left corner
folds it to a 56 px icon rail (no tooltip), instantly, until a reload. Below
`lg` it is a bottom bar of seven icon tabs.

**Phones.** The masthead's panels anchor to the viewport, controls are 40 px
under a coarse pointer, a canvas takes one finger as the pointer (a second
pinches the floor plan or abandons a pose being placed), and a tap does what a
double-click did. `CLAUDE.md` has the rules.

## The masthead

The status strip in `app/layout.tsx` is on every route. Left to right:

- **Robot id** — a link back to the dashboard, the way a site's logo is.
- **Emergency stop** — the driver's safety lock (`POST /api/v1/robot/estop`,
  read back as `low_level_mode.safety_locked`). One press or Shift+Space
  engages it; a one-second hold releases it. The backend cancels every running
  job on engage. It shows the lock the robot reports, so one engaged elsewhere
  shows here too. While engaged, driving, Stand, Lie down, goals and Run are
  refused, and the strip's bottom edge is red. Releasing restarts nothing.
- **Sensor alerts** — a motor above 85 °C turns the icon red and drops a
  notice naming the hottest joint (`lib/robot/heat-alert.ts`). Dismissing
  closes the notice; the dot stays until the motor is under 80 °C.
- **Drive panel** and **camera window** — collapsing either *unmounts* it. A
  hidden drive panel would be a live WASD listener; a hidden camera would hold
  the robot's single viewer slot. A clip in progress still finishes, since its
  capture handle outlives the window.
- **Running job** — from the backend's active list, so a run another console
  or a schedule started shows too. Pause / resume and cancel, then one bar:
  job id (from `lg`), step (`2/4 Speak`) and state (`Running`, `Pausing…`,
  `Paused`, `Resuming…`, `Completed`, `Failed`, `Canceled`). The buttons never
  leave the row — they grey instead — and the bar is never blank: idle reads
  `No task message in queue`, an unreadable list `Job list unavailable`.
  `Pausing…` lasts until the run's own read (`GET /api/v1/tasks/{id}`)
  confirms the hold. Refusals appear under the strip in the backend's words.

Below `sm` the strip wraps into two rows — id, stop, sensor, drive, camera and
battery on the first, the job across the second — from one row of markup, not
two copies.

## Layering

```
app/          route shells — a component owns the page
components/   console/ (shell, status strip, shared providers), dashboard/,
              drive/, mapping/, maps/, recordings/, tasks/, history/,
              settings/, webrtc/ (the bench), ui/ (shadcn primitives)
hooks/        one hook per backend interaction
lib/api/      typed fetchers per backend router, config.ts, http.ts, query-keys.ts
lib/ros/      WebSocket clients (telemetry, point cloud, teleop) and decoders
lib/map/      floor plan maths, drawing, zones, gestures, the job lock
lib/scene/    three.js scene building for the 3D viewport
lib/theme/    the signal hues both canvases draw with
lib/task/     step, schedule, history and running-job rules; the editor's draft
lib/robot/    joint table, motor names, readout thresholds, heat alert,
              controller fallback, emergency stop
lib/teleop/   thumbstick maths, key bindings, speed limit, axis lock
lib/recording/ recording size / duration formatting and the name rule
lib/video/    WHIP/WHEP signalling and the camera window's clip capture
lib/types/    wire and domain types shared across layers
```

The arrow runs one way — `app/` → `components/` → `hooks/` → `lib/` — and
`eslint.config.mjs` enforces every hop. A component reaches the backend only
through a hook. `CLAUDE.md` has the full directory map and the data-layer
conventions (queries, mutations, polling, invalidation, realtime).

**Backend addressing.** Every backend path goes through `apiUrl()` / `wsUrl()`
in `lib/api/config.ts` — never a literal host. Resolution order:
`NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_BASE` if set; otherwise the page's own
hostname on port 3000 (what makes `http://<robot-ip>:3001` work on the LAN);
otherwise `http://localhost:3000` for SSR / build time. The WS base swaps the
HTTP one's scheme.

## The robot mesh

`public/models/g23.glb` is **generated** by `scripts/urdf2glb.py` in the
`SyncAI-Robot-Workspace` repo, from `src/syncai_bringup/description/G23.urdf`
and its STLs. Two invariants the canvas depends on:

- GLB node names **equal URDF link names** — that is how telemetry joint
  angles find their mesh (`lib/robot/g23-joints.ts`).
- Coordinates stay **Z-up** (ROS), not glTF's +Y-up, so map coordinates pass
  straight through.

The script runs `gltfpack` (meshopt), decoded by `MeshoptDecoder`. Re-bake
after any URDF change, and check the result in a glTF viewer or on the
dashboard with telemetry running — there is no in-app preview.

## Fonts

`app/layout.tsx` loads Archivo and IBM Plex Mono through `next/font`.
Archivo's `axes: ["wdth"]` is load-bearing: without it the condensed
`.instrument-label` style silently renders at normal width.

## Running

```bash
npm ci             # the lockfile is authoritative; Node >= 22
npm run dev        # http://<host>:3001, HMR
npm run build && npm start

npm run lint       # eslint, including the layering rule
npx tsc --noEmit   # type check alone
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end (playwright; builds and starts the app itself)
```

CI (`.github/workflows/ci.yml`) runs the same gates on every push and PR to
`main` and `dev`. The e2e suite fakes the backend per test (`e2e/backend.ts`),
so it needs no robot, and runs as both a desktop and a 375×667 touch Chromium.

On the robot this repo sits inside the `SyncAI-Robot-Workspace` tree, where
`NodeManager` starts `npm run dev` in the `frontend` window.

**`allowedDevOrigins` is detected, not configured.** Next 16 only trusts
`localhost` for dev/HMR, so `next.config.ts` lists this host's own
non-internal addresses at startup (restart after a network change). Reaching
the dev server **by name** (mDNS, DNS, a proxy, a tunnel) is not covered — set
`SYNCAI_DEV_ORIGINS` to comma-separated hostnames, no scheme or port:

```bash
SYNCAI_DEV_ORIGINS=robot-01.lan,10.8.140.138 npm run dev
```

A blocked request's 403 log names the exact host to add.

## Container image

`docker-compose.yaml` has `frontend-build`, which builds and tags the image
(behind the `build` profile, so an `up` never starts a build by accident), and
`frontend`, which runs that tag. Values come from `.env`:

```bash
cp .env.example .env               # edit if 3001 is taken or the backend is elsewhere
docker compose build frontend-build
docker compose up -d frontend      # http://<host>:3001
docker compose logs -f frontend
docker compose down
```

The backend is not in the compose file: the page calls port 3000 of whatever
host it was opened from. `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_BASE` are
**build args**, not runtime environment — Next inlines them — so pointing at a
backend elsewhere means setting them in `.env` and rebuilding. Leave them
empty for the same-host case.

**Pulling instead of building.** `.github/workflows/release.yml` publishes
`ghcr.io/chungweeeei/syncai-robot-frontend` (arm64 + amd64, `NEXT_PUBLIC_*`
empty). Every push to `main` moves the `main` tag and adds `sha-<short>`; a
`vX.Y.Z` tag on `main` publishes `X.Y.Z`, `X.Y` and `latest`.

```bash
# .env
FRONTEND_IMAGE=ghcr.io/chungweeeei/syncai-robot-frontend
FRONTEND_TAG=1.2.0          # or `main` to track the release branch
```

```bash
docker compose pull frontend && docker compose up -d frontend
```

Nothing is published until the first `dev` → `main` release PR lands, since
the workflow only runs once it is on `main`. GHCR creates the package private,
so someone has to make it public on GitHub or every robot must `docker login`.
The robot sessions still run `npm run dev` today.
