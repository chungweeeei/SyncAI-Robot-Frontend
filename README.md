# SyncAI-Robot-Frontend

The operator console for one SyncAI robot (npm package name:
`syncai_frontend`). It is a browser client of
`syncai_backend` and nothing else: every byte it shows comes from that
process's REST/WebSocket surface on port **3000**, and it holds no robot state
of its own beyond what a page needs to render.

- **Next.js 16.2.10** (App Router) + **React 19**. The pinned Next has breaking
  changes relative to what models were trained on — read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code (see `CLAUDE.md`).
- **shadcn-style UI** (`components/ui/`) built on `@base-ui/react`, Tailwind 4.
- **TanStack Query** for every REST read, each one parsed through a **zod**
  schema at the boundary.
- **Raw three.js** for the 3D view — no react-three-fiber. The robot's camera
  reaches the operator over **WebRTC** (`lib/video/`) as a movable, resizable
  window any screen can open from the masthead. The `/webrtc-test` bench is
  where a video fault gets diagnosed: unlisted — no nav rail entry, opened by
  hand — but it renders in every build, including on the robot, which is the
  only place the video path can actually be tested. The window can also save a
  short clip of what the camera sees, video only, as a browser download onto
  the operator's own machine; nothing is written on the robot.

Dev server, production server and the container all listen on **3001**
(`next dev -p 3001` / `next start -p 3001` in `package.json`, `PORT=3001` in
the `Dockerfile`), so the console and the backend can share a host without a
proxy.

## Routes (`app/`)

| Route | What it is |
|---|---|
| `/` | Dashboard: `PointCloudView` (live cloud, map, robot mesh, route, vertices) left, `TelemetryRail` right. Gated on `GET /api/v1/robot/state` — no state, no panels. |
| `/mapping` | Mapping mode: switch `AUTO`/`MANUAL`, drive it around from the masthead's drive panel, watch pgo's "map so far" stream, save the map and watch its 2D grid build, or discard the run and start a new map. The page owns the confirmation rule and drives a single alert dialog from it: **every** act here is confirmed, including a plain mode switch in either direction (it tears the stack down for ~30 s and stops whatever the robot was doing), and losing an unsaved run is what escalates the copy and turns the confirm button red. |
| `/maps` | The map library (`MapLibrary`): catalogue cards, thumbnails, per-card gridmap state (and why a conversion failed), Rebuild-grid, inline Rename, Delete as an X in the card's corner (Rename and Delete are greyed on the map in use — the backend refuses them too; Delete confirms in an alert dialog that names the map and counts the vertices and megabytes going with it), and **Switch**, which is what un-greys the other two. Switch is the card's top-left corner tile, in the same slot as the in-use badge and never shown beside it: a solid check where the robot is, swap arrows on every map it could move to. (Not an unfilled check — that reads as "already done, greyed out", which is a state this control genuinely has for maps it cannot switch to.) It is a live call — it re-points the running localizer and map_server and rewrites the instance INI, no stack restart — and its alert dialog carries the one consequence an unlabelled arrow cannot: the pose resets to the new map's origin, so set an initial pose on the dashboard afterwards. All three controls hand their result sentence up to one line above the grid. |
| `/maps/[name]/edit` | The gridmap editor — replaces a step that used to be done in GIMP. Its title renames the map in place: double-click it (or press F2 on it) and Enter saves, Escape cancels — no button, and refused outright while the gridmap is dirty, since a rename moves the directory and the reload that follows would drop the buffer. Its Vertex mode also places stops. It opens on **Pan** like the grid half does — a press drags the map — and the tool row arms the other two: **Place** stages a vertex where you press (drag to aim it), **Select** drags a box over several, with Shift to add to the set and a Delete for the whole band. Escape disarms back to Pan. A stop you mark by driving to it instead comes from **Use robot position**. The robot's own footprint is drawn (to scale, `signal-live`, in both modes) wherever it is standing — both it and the button are offered only while the robot is localized on *this* map, and the button names the reason when it is not. The other half of that button — driving to the stop you are about to mark — is the masthead's drive panel, which this editor no longer mounts itself; the panel comes up disarmed and its WASD/QE set does not collide with the editor's Space / 0 / Ctrl+Z. |
| `/recordings` | Bag recording: start a `ros2 bag record` on the robot, watch it grow, and manage what is on disk. The recorder panel has two faces rather than one with disabled fields — idle asks what to record (name, topic chips defaulting to the LIO inputs, zstd off), live reports the elapsed clock, bytes written and resolved topic names — and which face is shown comes from `GET /api/v1/recordings/active`, not from a local "we pressed Start" flag, so a recording started from a shell or a second console is shown correctly and one that died is reaped within the second. The list below is every bag on the robot, newest first, with the live one still in it; a finished bag with zero messages is called out, because nothing refuses a topic that does not exist (the recorder waits for it, so it can be armed before bringup) and a typo is otherwise silent. Delete is the row's X, behind the map library's alert dialog, and is refused for the live recording. |
| `/settings` | Appearance + wifi (`nmcli` through the backend). |
| `/tasks` | Task console: template library, step composer, dispatch, registered schedules, the active run. **Steps.** A step row folds to a one-line readback of what was typed, and folded is the default — a twenty-step patrol unfolded is three screens of inputs, and a template loaded to be reviewed or reordered wants the summary. A row just added opens for filling in; a row that is unfinished shows its problem on the folded line and stays open. Reorder by the row's drag handle or its move menu (top, bottom, one either way); the step ids are positional, so the order shown is the order posted. A Move step is set by picking a waypoint and nothing else — there are no coordinate fields, so when the robot has no map, the map has no waypoints, or they cannot be read, the row says what to do on the floor plan instead and stays unsendable. Beside the picker sits the floor plan itself, every waypoint marked by name and the row's pick lit, because a name in a list is not a place: clicking a marker picks it, the same as choosing it from the list. **Schedules.** One Repeat picker — Daily, Weekdays, Weekends, Custom (the seven day toggles), Interval (a count in minutes or hours) — plus a clock time. Cron is never typed and never shown: it is built on the way out and read back as a sentence on the way in, and a cron this console could not have written is shown verbatim rather than as a sentence it does not mean. A preview line built from the same description the list renders says what will be registered, with its next run, before anything is sent. **Next run** is on the operator's own clock (UTC only in the server render, labelled as such, until the browser says which clock that is). The list is not polled — the soonest run in it is the one moment it goes stale on its own, so it re-reads itself just after that, and a row steps over a run that has already fired rather than going on naming it as the next one. |
| `/history` | Job history: finished runs from `GET /api/v1/task_history`, newest close first, filterable by outcome. Previous / Next paging: the endpoint only pages forward and has no total count, so the console keeps the cursors it was handed to step back, and shows "Page N" without an "of M". Ten jobs per page. Each row is titled by the job id, with who started it (a schedule or directly) under it; the per-step results, read from `GET /api/v1/tasks/{id}`, appear only when the row is opened. There is no poll; the list is refreshed when a run drops out of the console's active-task poll. It reaches back only as far as Temporal's retention, a day by default, which is also why there is no time-range filter. |
| `/webrtc-test` | The WHIP/WHEP bench — unlisted (no nav rail entry, opened by hand) but built into every image, because the robot only ever runs a production build and that is the one machine where the video path can be tested. The only consumer that exercises WHIP. |

## The masthead

Two controls hang off the status strip in `app/layout.tsx`, so they are on
every route rather than on whichever page happens to own a viewport: the
**drive panel** (`DriveDisclosure` → `ManualControl`) and the **camera window**
(`CameraDisclosure` → `CameraWindow`). Both used to be anchored inside a page —
driving in the bottom-right corner of three viewports, the camera only on
`/webrtc-test` — and moving them up means "can I nudge the robot from here" and
"can I see what it sees from here" have the same answer everywhere.

Collapsing either one **unmounts it**, and that is load-bearing in both cases.
The drive panel's keyboard half is a window-level WASD listener, so a panel
kept alive while hidden would be a live teleop with nothing on screen saying
so; unmounting disarms it and closes the teleop channel, and the backend's
watchdog zeroes `cmd_vel`. The camera window holds the robot worker's single
viewer slot, so a hidden-but-alive session would keep the camera away from
whoever opens it next — including the bench. The cost is that reopening the
camera renegotiates from scratch, a second or so of "Connecting" before the
first frame.

The one thing that deliberately outlives its window is a **clip**: the capture
handle is created in the click handler and owns its recorder and its delivery,
so closing the camera window mid-capture still writes the file.

## Layering

```
app/          route shells; almost no logic ("chrome only" — a component owns the page)
components/   console/ (shell: nav rail, status strip, shared providers, and the
              strip's two disclosures — see The masthead), dashboard/, mapping/,
              maps/, recordings/, tasks/, settings/, webrtc/ (the bench),
              ui/ (shadcn primitives)
hooks/        one hook per backend interaction (use-maps, use-active-tasks, use-teleop-sender…)
lib/api/      typed fetchers per backend router + config.ts + query-keys.ts
lib/ros/      the WebSocket clients (telemetry, point cloud, teleop) and their frame decoders
lib/map/      gridmap maths — view transforms, patches, the editing session, vertex
              helpers, the map name rule, the 2D drawing (draw.ts) and the editor's vocabulary
lib/scene/    three.js scene building for the 3D viewport — theme, markers, the
              vertex layer, the path ribbon, camera policy, picking, robot mesh
lib/theme/    the signal hues both canvases draw with, transcribed from globals.css
lib/task/     step and schedule domain helpers, the template name limit
lib/robot/    G23 joint table (URDF link names ↔ GLB node names)
lib/recording/ how a bag's duration / size / message count are read, shared by the two
              recording surfaces so one quantity never appears in two spellings
lib/video/    WHIP/WHEP signalling, and the clip the camera window saves to the
              operator's machine (the WebRTC note above)
lib/types/    wire and domain types shared across layers (map, robot, pointcloud, stream)
lib/angle.ts  normalizeTheta — the degree fold every heading goes through
lib/download.ts  downloadBlob — the one path that writes a file to the
              operator's own machine
```

The arrow runs one way — `app/` to `components/` to `hooks/` to `lib/` — and
`eslint.config.mjs` enforces every hop of it, so a break fails `npm run lint`.
A component may name the wire types (`import type` from `lib/api` is allowed,
as is `apiUrl` from `lib/api/config`) but reaches the backend only through a
hook. A rule the backend enforces and a form mirrors — a name regex, a length
limit, the heading fold — lives with its domain rather than in the REST client:
`lib/map/name.ts`, `lib/recording/name.ts`, `lib/task/template.ts`,
`lib/angle.ts`. The
two console-wide React contexts are split along that line: the context object
and its `useConsole*` accessor sit in `hooks/`, the provider component in
`components/console/`, so a hook can read the shared poll without importing
upwards.

**Backend addressing.** Every backend path goes through `apiUrl()` / `wsUrl()`
from `lib/api/config.ts` — never a literal host. Resolution order:
`NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_BASE` if set; otherwise the page's own
hostname on port 3000 (what makes `http://<robot-ip>:3001` work on the LAN);
otherwise `http://localhost:3000` for SSR / build time. The WS base is derived
from the HTTP one by swapping the scheme. Even `<img src>` for map thumbnails is
absolutised through `apiUrl`, because a relative URL would resolve against the
frontend's own origin.

**REST reads go through TanStack Query.** One `QueryClient` lives in
`components/query-provider.tsx` with `retry: false` and
`refetchOnWindowFocus: false` — the poll intervals *are* the retry policy, and
the status indicators exist to report a failure the moment it happens. Every
cache key lives in `lib/api/query-keys.ts`, so cache *sharing* between hooks is a
decision visible in one place: the gridmap editor and the dashboard read the
same `mapVertices` entry, which is what makes a vertex moved on one screen
already current on the other. Add new keys there, never inline in a hook.

**REST writes go through TanStack too**, as `useMutation` hooks — one per
backend write (`hooks/use-map-actions.ts`, `use-mapping-run.ts`,
`use-recorder.ts`, `use-cancel-task.ts`, and the write halves of the vertex,
template and schedule hooks). A hook's `onSuccess` owns what the response
makes stale, so "who invalidates `taskTemplates` when a map is renamed" is
answered in the hook, not in whichever card happened to send the request.
Components read `isPending` / `error` / `data` off the mutation; the backend's
`detail` sentence is still what they render.

The hooks that **command the robot** (`use-goal-task`, `use-posture`,
`use-task-dispatch`, `use-initial-pose`, `use-locomotion`, `use-mode-switch`,
`use-wifi-connect`) are mutations as well, but they invalidate nothing — a
motion key makes no cached resource stale. Each pairs its request with a
*reader* that says what the robot did with it: `useTaskTracker`'s 1 Hz poll for
anything dispatched as a Temporal task, and the shared `robot_state` poll for
the two that talk to the machine directly. The two that can kill their own
responder — a mode switch and a WiFi join — read a `fetch` TypeError as
"in progress", never as a failure.

**The WebSocket streams stay outside TanStack** — a push stream has nothing to
refetch — and inside them React state is used by rate, not by habit. The point
cloud never touches it: frames (`[u32 count][f32 xyz…]`, ~10 Hz × a few hundred
KB) go straight into three.js buffers in
`components/dashboard/pointcloud-canvas.tsx`. Pose and joints (~20 Hz each, in
`hooks/use-telemetry.ts`) do not either: they are refs the canvas drains once
per drawn frame, because a prop is a render and the viewport subtree is barely
memoised. The planner's `path` is state, since it lands ~0.333 Hz and the view
branches on whether a route exists. `hooks/use-teleop-sender.ts` sends
`{vx, vy, wz}` at ~10 Hz off a ref on an interval.

The shell in `app/layout.tsx` runs exactly **two polls** for the whole console
(`RobotStateProvider` at 1 Hz, `ActiveTaskProvider` at 2 s); pages read those
providers rather than polling on their own, so the header can never disagree
with the rail.

**The one self-cancelling poll is the gridmap conversion.** Saving a map starts
a pcd → gridmap conversion in a backend thread that runs for tens of seconds
after the POST has answered, and it has no push channel — the backend keeps no
job resource and a conversion finishing is not a ROS topic. So `hooks/use-maps.ts`
re-reads the catalogue every 2 s while any map reports `grid_status:
"converting"` and stops with the last one; the status is both the trigger and
the off switch. `useMapConversion(name)` is the same query entry scoped to one
map, which is how `/mapping`'s save control reports the outcome without a second
request — and it is why a failed conversion now says so on screen instead of
only in the robot's backend log.

## The robot mesh

`public/models/g23.glb` is **generated**, and the generator does not live in
this repo: `scripts/urdf2glb.py` at the root of the `SyncAI-Robot-Workspace`
repo bakes it from `src/syncai_bringup/description/G23.urdf` and its STLs.
Two invariants the canvas depends on: GLB node names **equal URDF link names**
(that is how joint angles from the telemetry stream find their mesh — see
`lib/robot/g23-joints.ts`), and the coordinates stay **Z-up** in the ROS
convention rather than glTF's nominal +Y-up, because the canvas builds a Z-up
world so map coordinates pass straight through. The script runs `gltfpack`
(meshopt compression), which the canvas decodes with `MeshoptDecoder`. Re-bake
after any URDF change. There is no in-app preview for the result any more —
`/model-preview` was removed — so check a re-baked GLB in a glTF viewer, or
against the dashboard with the robot publishing telemetry.

## Fonts

`app/layout.tsx` loads Archivo and IBM Plex Mono through `next/font`. Archivo's
`axes: ["wdth"]` is load-bearing: without it `next/font` ships the weight-only
subset and the condensed `.instrument-label` style in `globals.css` silently
renders at normal width.

## Running

```bash
npm ci             # the lockfile is authoritative; Node >= 22
npm run dev        # http://<host>:3001, HMR
npm run build && npm start

npm run lint       # eslint, including the layering rule above
npx tsc --noEmit   # type check alone
npm test           # unit tests (vitest)
npm run test:e2e   # end-to-end (playwright; builds and starts the app itself)
```

`.github/workflows/ci.yml` runs the same four gates on every push and PR to
`main` and `dev`; `CLAUDE.md` describes the split.

The e2e suite fakes the backend per test (`e2e/backend.ts`), so it needs no
robot and no `syncai_backend` running.

On the robot this repo is checked out inside the `SyncAI-Robot-Workspace`
tree, where `NodeManager` starts `npm run dev` in the `frontend` window of both
session specs (that repo's `config/sessions/*.yaml`).

**`allowedDevOrigins` is detected, not configured.** Next 16 only trusts
`localhost` for dev/HMR requests, so opening the dashboard from another origin
(the container's bridge IP, a robot's LAN address) breaks the HMR WebSocket
unless that origin is listed. `next.config.ts` builds the list at startup from
this host's own non-internal interface addresses, which covers the
laptop-on-a-new-network and inside-a-container cases without editing a tracked
file. The list is fixed when the dev server boots — a new Wi-Fi network or DHCP
lease needs a restart.

Only addresses are detected, so reaching the dev server **by name** — an mDNS
`<host>.local`, a DNS entry, a reverse proxy, a tunnel — is not covered. Set
`SYNCAI_DEV_ORIGINS` to a comma-separated list of hostnames for those, with no
scheme and no port, since Next matches on hostname alone:

```bash
SYNCAI_DEV_ORIGINS=robot-01.lan,10.8.140.138 npm run dev
```

When a request is still blocked, Next's 403 log names the exact host to add.

## Container image

`docker-compose.yaml` has two services: `frontend-build` builds and tags the
image (behind the `build` profile, so an `up` on the robot never kicks off a
`next build` by accident) and `frontend` runs that tag with no `build:` block
of its own. Values come from `.env`, copied from `.env.example`:

```bash
cp .env.example .env               # edit if 3001 is taken or the backend is elsewhere
docker compose build frontend-build
docker compose up -d frontend      # http://<host>:3001
docker compose logs -f frontend
docker compose down
```

The image serves on **3001** like `package.json` does (the standalone server
ignores the npm scripts and reads `PORT`, which the `Dockerfile` sets). The
backend is not in the compose file: the console is a browser client, and the
page calls port 3000 of whatever host it was opened from, so the two need the
same host name and nothing more. `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_BASE`
are **build args**, not runtime environment — Next.js inlines `NEXT_PUBLIC_*`
into the bundle — so pointing the console at a backend on another machine
means setting them in `.env` and rebuilding, not restarting. Leave them empty
for the same-host case.

**Pulling it instead of building it.** `.github/workflows/release.yml`
publishes the image to GitHub Container Registry as
`ghcr.io/chungweeeei/syncai-robot-frontend`, multi-platform (arm64 for the
Jetson, amd64 for a PC), with the `NEXT_PUBLIC_*` pair left empty so the
same-host fallback holds on any robot. Every push to `main` moves the `main`
tag and adds a `sha-<short>` one; a `vX.Y.Z` git tag on `main` publishes
`X.Y.Z`, `X.Y` and `latest`. On the robot, point `.env` at it and skip the
build service:

```bash
FRONTEND_IMAGE=ghcr.io/chungweeeei/syncai-robot-frontend
FRONTEND_TAG=1.2.0          # or `main` to track the release branch
```

```bash
docker compose pull frontend && docker compose up -d frontend
```

Two things gate the first publish. The workflow only fires once it exists on
`main`, and `main` is still at the repository's initial commit — so nothing is
published until the first `dev` → `main` release PR lands, which then triggers
it by itself. And GHCR creates the package private even for a public repo, so
someone has to open the package's settings on GitHub and make it public, or
every robot has to `docker login` first. The robot sessions still run
`npm run dev` today; nothing deploys the image on its own.
