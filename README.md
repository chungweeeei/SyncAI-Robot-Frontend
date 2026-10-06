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

Each row is what the route is for and the rules a reader cannot see by opening
it; the controls themselves are on screen.

| Route | What it is |
|---|---|
| `/` | Dashboard: the 3D viewport (live scan, the map's scan, the robot mesh, the planned route, waypoints, forbidden zones) with the pose over its bottom-left corner, and the instrument rail on the right — the registered schedules first (pause or delete one from its menu; registering and editing stay on `/tasks`), then posture, locomotion and motors. Gated on `GET /api/v1/robot/state`: no state, no panels. Forbidden zones are read once when the page opens, so a zone saved from another console shows after a reload. While a job drives on the waypoints' map, placing, moving and deleting a waypoint are greyed with the reason (the run lock under `/maps`) and a pick armed when the lock arrives is disarmed; a goal is held while the active map's floor plan is being rebuilt. |
| `/mapping` | Mapping mode: the rail switches `AUTO`/`MANUAL`, and the run itself is one strip over the viewport whose face follows the robot's own run state (`GET /api/v1/mapping`, polled while in Mapping) — **Start mapping** while idle, then a recording-style indicator beside **Save** and **New map**. Drive from the masthead's drive panel. The "map so far" layer is always streamed and has no toggle, so whether a map exists yet is read off the picture. Save asks for the name in a dialog that then stays open as the receipt — the robot's sentence and the floor plan's progress — and ends the run, leaving the robot idle for the next Start; a refused Start or New map stays under the strip, in the robot's words, until the next press. Every act that rebuilds or discards something is confirmed, including a plain mode switch in either direction (it tears the stack down for ~30 s and stops whatever the robot was doing), and losing an unsaved run is what escalates the copy and turns the confirm red. A start is the one press with no dialog, since it discards nothing. |
| `/maps` | The map library: a card per map with its thumbnail, floor plan state and the reason a conversion failed. **Switch** is the card's top-left tile, in the in-use badge's own slot — a live call that re-points the running localizer and map_server with no stack restart, and resets the pose to the new map's origin, which is the one consequence its dialog carries. Rename, Edit, Export and Delete sit in the top-right corner; Rename and Delete are greyed on the map in use, because the backend refuses them there, while Edit stays open on it since a floor plan saved onto the live map is reloaded in place. **Export** writes `<name>.zip` (the map directory and its waypoints); **Import**, above the grid, takes such an archive with a **Save as** field pre-filled from the filename, and a name already in the catalogue turns the confirm into a red **Replace**, because the backend overwrites that map rather than refusing. Every control hands its result up as the backend's own sentence on one line above the grid. **A map a job drives on is read-only for the job's length**: while a running job names a map (`map_name` in `GET /api/v1/active_tasks`), its Rebuild and Edit are greyed with the reason and the editor holds every write on it. The backend is the gate — it refuses those writes with `task_running`, for every console and for a schedule nobody here started — and the console only greys first, keyed on the job's map and never on which map is active; while that poll is loading or failing the map is treated as locked, since an unknown read as idle is how an edit lands under a moving robot. |
| `/maps/[name]/edit` | The floor plan editor — it replaces a step that used to be done in GIMP. Two icon strips along the top: a **Draw** list (No type, Wall, Floor, Unknown, Waypoint, Forbidden zone) that decides what a press does, and Fit to view, Undo / Redo, Save and that kind's tools — Brush / Line / Rect and a size for cells, Place / Select for waypoints, Shape / Done / Remove for a zone. It opens on No type, so a press only drags the map, and every change of kind lands on Pan. The title renames the map in place (double-click, or F2, then Enter), and is refused outright while the grid is dirty, since a rename moves the directory and the reload that follows would drop the buffer. **Use robot position** marks the stop you drove to, and is offered only while the robot is localized on *this* map. Cells and forbidden zones are two things saved separately — `PUT /api/v1/maps/{name}/keepout` beside the grid, whichever has changes, each with a note of its own — and removing a zone is sent at once rather than waiting for Save, so unsaved cell work is never carried along with it. If the zones cannot be read, the kind is greyed with the reason and the floor plan stays editable, because a list saved over one never read would erase it. `?mode=vertex` and `?from=tasks` are what the task editor's links set. While a job drives on this map, every write is held with the reason on screen; strokes, shapes and a typed name stay in the editor until the job ends. |
| `/recordings` | Recording: start a `ros2 bag record` on the robot, watch it grow, and manage what is on disk. The recorder has two faces rather than one with disabled fields — idle asks for a name, the channels (the scanner, its motion sensor and the body IMU by default) and compression; live reports the elapsed clock, bytes written and the resolved channel names. Which face is shown comes from `GET /api/v1/recordings/active`, never from a local "we pressed Start" flag, so a recording begun from a shell or a second console is shown correctly and one that died is reaped within the second. The list below is every bag on the robot, newest first, with the live one still in it. A bag that did not close cleanly carries a No index chip, and a finished bag with zero messages is called out, because nothing refuses a channel that does not exist — the recorder waits for it, so it can be armed before bringup — and a typo is otherwise silent. Delete is the row's X and is refused for the live recording. |
| `/settings` | Preferences (theme, waypoint labels, language) and Wi-Fi (`nmcli` through the backend), plus a red **Restart** in the header's top right that rebuilds the robot's software in the mode it is already in, behind a confirm that warns when a job is running. Offered only in Navigation and while the link is up — the backend refuses Mapping, whose unsaved map lives in memory. The outcome is read from `GET /api/v1/robot/restart`, polled only while it says `restarting` (~30 s), not from `/robot/state`, which keeps answering with the last frame through the rebuild. |
| `/tasks` | Task overview: the saved jobs, the registered schedules and any run in progress. A row's **Run** dispatches it, **Schedule** opens the trigger form at the top of the schedules, and **Load** opens it in the editor — asking first when it would clear unsaved steps. Every job is listed whichever map it is for: one for another map is marked and its Run and Schedule are held. A Run sends the map the job was planned on (`map_name`), so a map switched since the list was read is refused by the backend (`map_mismatch`) rather than driven on the map that replaced it. **Schedules** are built from one Repeat picker — Daily, Weekdays, Weekends, Custom, Interval — plus a time: cron is never typed and never shown, it is built on the way out and read back as a sentence on the way in, and a cron this console could not have written is shown verbatim rather than as a sentence it does not mean. Next run is on the operator's own clock (UTC in the server render, labelled as such, until the browser says which clock that is). The list is not polled — the soonest run in it is the one moment it goes stale on its own, so it re-reads itself just after that, and a row steps over a run that has already fired rather than going on naming it as the next one. |
| `/tasks/editor` | Task editor: the step list, under a heading that is the job's name. It neither runs nor schedules a job — both are a saved job's row on `/tasks`. The header holds **Go back**, **Save** (which updates the loaded job or creates one, asking for a name in the heading first) and, for a saved job, **Delete**, which names any schedules of it and returns to `/tasks`. A step row folds to a one-line readback of what was typed and folded is the default, since a twenty-step patrol unfolded is three screens of inputs; an unfinished row shows its problem on that line and stays open. Reorder by the drag handle or the move menu — the step ids are positional, so the order shown is the order posted. A Move step is set by picking a waypoint and nothing else: there are no coordinate fields, so a job with no map, no waypoints or an unreadable list says what to do on the floor plan instead and stays unsendable. The **Map** picker says which map those waypoints come from and can be pointed at another, so a job for the second floor can be built while the robot is on the first; switching clears the waypoints already picked, behind a confirm. The map button beside a Move row opens that floor plan under the picker with every waypoint marked and the job's own lit by step number — a view, not a picker, because a name in a list is not a place. **What is in the editor stays in the tab**: the steps, the loaded template, the map choice and a new job's name survive a walk back to `/tasks` and a reload, and go away with the tab — they are unsaved work, not something on the robot. |
| `/history` | Job history: finished runs from `GET /api/v1/task_history`, newest close first, under a dashboard of how the chosen window's jobs ended — finished / completed / failed / canceled, a success rate and one bar — from `GET /api/v1/task_history/stats`. Four pickers scope it (time window, outcome, kind, template name) and live in the address bar, so a view can be bookmarked or sent. The outcome narrows the list only: the dashboard is read without it, so it stays how the window's jobs ended rather than a tautology about the rows, and says under its tiles which outcome is listed. The endpoint pages forward only and has no total count, so the console keeps the cursors it was handed to step back and shows "Page N" without an "of M", ten jobs per page. A row is titled by the template it ran, else by its kind, and only by the job id for a run nothing labelled; the id and the per-step results are read when the row is opened. There is no poll — the list and the counts refresh when a run drops out of the console's active-task poll — and it reaches back only as far as Temporal's retention. |
| `/webrtc-test` | The WHIP/WHEP bench — unlisted (no nav rail entry, opened by hand) but built into every image, because the robot only ever runs a production build and that is the one machine where the video path can be tested. The only consumer that exercises WHIP. |

On a phone (below `lg`) the nav rail is a bottom bar of seven equal icon-only
tabs, the masthead's drive panel and camera window anchor to the viewport
rather than to their buttons, every control is 40 px under a coarse pointer,
and the two canvases take a finger as one pointer: a second finger pinches the
floor plan or abandons a pose being placed, never a second press. A tap does
what a double-click did — opens a stop's dialog on the dashboard, puts a
floating panel back when it lands on the grip. `CLAUDE.md` has the rules.

## The masthead

Two panels hang off the status strip in `app/layout.tsx`, so they are on
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

Left of the drive panel is the **sensor alerts** button (`SensorDisclosure`),
where an overheating motor interrupts on every screen. A motor above 85 °C
turns the icon red with a dot on it and drops **A motor is overheating** under
it on its own, naming the hottest joint by the motor grid's own codes and its
temperature (rule in `lib/robot/heat-alert.ts`). It has no timer: Dismiss (or
the button, or Escape) closes the notice, but the dot stays until the motor has
fallen under 80 °C, and pressing the button while it is lit reopens the notice
to read. A dismissed notice drops again only after the motor has cooled and
crossed 85 °C again, so a joint hovering at the limit does not flicker it.
Pressed with nothing to report, it says the motors are within limits and names
the hottest one.

The strip also carries the **running job**, from the backend's active list
rather than from this tab, so it is there for a run another console or a
schedule started. It is two icon buttons — pause (⏸, which becomes resume ▶
once the hold has landed) and cancel (✕) — and then one bar, capped at 32rem
and flush against the health cluster on the right. The bar reads, left to
right: the job id (from `lg` up), the step the robot is on (`2/4 Speak`), and
at its right end the state — `Running`, `Pausing…`, `Paused`, `Resuming…`,
`Completed`, `Failed`, `Canceled`.

Neither the buttons nor the bar ever leave the row, and for two different
reasons. The pair is fixed so a control that disappears cannot slide the one
beside it under a finger already on its way: a job that cannot be held (a
Stand or a Lie down, whose one step is not interruptible and has no next step
to hold before) greys its pause and says why on hover, and a job that has
closed greys both. The bar is permanent because an empty slot is also what a
readout that failed to render looks like, so an idle robot says
`No task message in queue` in so many words, and a list that cannot be read
says `Job list unavailable` in the caution hue — an empty slot over a driving
robot is the one thing this readout must never show.

The step comes from the run's own read (`GET /api/v1/tasks/{id}`), the only
place a held run is visible, since the active list says `IN_PROGRESS` for it.
A pause is a request: the bar says `Pausing…` until that read confirms
`Paused`, because a line being spoken or a posture being taken finishes before
the hold lands, while a move stops at once. Nothing in the bar animates, by
request: the state word says whether the job is going, and a loop behind a
readout an operator reads all day only repeats a fact already on the row.
The job's name and elapsed time are on hover, and the bar is a link to
`/tasks`. A refusal (the run closed
between the read and the press, or a backend without the pause routes) appears
under the strip as the backend's own sentence.

Below `sm` the strip is **two rows**: the id, mode, sensor, drive, camera and battery
on the first, the job's buttons and bar across the full width of the second.
One wrapping flex row rather than a second copy of the component — rendering
it twice and hiding one would put two pause buttons and two live readouts in
the accessibility tree.

## Layering

```
app/          route shells; almost no logic ("chrome only" — a component owns the page)
components/   console/ (shell: nav rail, status strip, shared providers, and the
              strip's disclosures — see The masthead), dashboard/, mapping/,
              maps/, recordings/, tasks/, history/, settings/, webrtc/ (the bench),
              ui/ (shadcn primitives)
hooks/        one hook per backend interaction (use-maps, use-active-tasks, use-teleop-sender…)
lib/api/      typed fetchers per backend router + config.ts + http.ts + query-keys.ts
lib/ros/      the WebSocket clients (telemetry, point cloud, teleop) and their frame decoders
lib/map/      gridmap maths — view transforms, patches, the editing session, vertex
              helpers, the map name rule, the 2D drawing (draw.ts) and the editor's
              vocabulary; the forbidden zone rules (zone.ts), the task editor's floor
              plan preview (preview.ts), the gesture rules both map surfaces share
              (gesture.ts), the job lock (run-lock.ts) and the mapping strip's face
              rule (run-face.ts)
lib/scene/    three.js scene building for the 3D viewport — theme, markers, the vertex
              and zone layers, the path ribbon, camera policy, picking, robot mesh
lib/theme/    the signal hues both canvases draw with, transcribed from globals.css
lib/task/     step, schedule and history domain helpers, the template name limit, the
              masthead's rules for the running job (run.ts) and the editor's unsaved
              draft (draft-store.ts — the one place that touches browser storage)
lib/robot/    G23 joint table (URDF link names ↔ GLB node names), how a motor is named,
              the readout thresholds (levels.ts), the overheating notice's rule
              (heat-alert.ts) and the commanded controller's fallback to RL (controller.ts)
lib/teleop/   thumbstick maths — clamp, deadzone, key bindings, the linear speed limit
              and the screen-to-body-frame turn the drive panel commands through
lib/recording/ how a bag's duration / size / message count are read, shared by the two
              recording surfaces so one quantity never appears in two spellings
lib/video/    WHIP/WHEP signalling, and the clip the camera window saves to the
              operator's machine (the WebRTC note above)
lib/types/    wire and domain types shared across layers (map, robot, pointcloud, stream)
lib/angle.ts  normalizeTheta — the degree fold every heading goes through
lib/keyboard.ts  isTypingTarget — whether a focused element is really taking letters,
              which is what keeps the drive keys alive beside a slider
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
`use-wifi-connect`, `use-task-hold`) are mutations as well, but they invalidate
nothing — a motion key makes no cached resource stale. Each pairs its request
with a *reader* that says what the robot did with it: `useTaskTracker`'s 1 Hz
poll for anything dispatched as a Temporal task, and the shared `robot_state`
poll for the two that talk to the machine directly. A request is never shown as
a reading: a hold is `Pausing…` until the run's own read says `Paused`, which
is why the masthead derives that word rather than storing it. The two that can
kill their own responder — a mode switch and a WiFi join — read a `fetch`
TypeError as "in progress", never as a failure.

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

The shell in `app/layout.tsx` runs the only **two unconditional polls** in the
console (`RobotStateProvider` at 1 Hz, `ActiveTaskProvider` at 2 s); pages read
those providers rather than starting a robot-state poll of their own, so the
header can never disagree with the rail. Everything else polled switches itself
off (below).

**A poll runs only while the server is changing something on its own, and the
status that started it is what stops it.** The clearest case is the floor plan
conversion: saving a map starts a pcd → gridmap conversion in a backend thread
that runs for tens of seconds after the POST has answered, and it has no push
channel — the backend keeps no job resource and a conversion finishing is not a
ROS topic. So `hooks/use-maps.ts` re-reads the catalogue every 2 s while any map
reports `grid_status: "converting"` and stops with the last one; the status is
both the trigger and the off switch. `useMapConversion(name)` is the same query
entry scoped to one map, which is how `/mapping`'s save dialog reports the
outcome without a second request — and it is why a failed conversion now says so
on screen instead of only in the robot's backend log. The rest follow the same
shape: `useRecordings` while a bag is live, `useMappingStatus` while `/mapping`
is open and the robot is mapping, `useActiveRun` while the active list names a
running job, `useRobotRestart` while the robot answers `restarting`.
`useSchedules` is the variant where the data itself says when it next changes —
it derives its interval from the soonest next run rather than choosing one.

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
robot and no `syncai_backend` running. It runs twice: once as a desktop
Chromium and once as a phone-sized one (`e2e/mobile.spec.ts`, 375×667 with
touch), which is what keeps the layout and the two-finger rules above honest.

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
