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
| `/` | Dashboard: `PointCloudView` (live cloud, map, robot mesh, route, vertices, forbidden zones) left, `TelemetryRail` right. The running map's forbidden zones are drawn as a red wash on the floor, under the route and the stops, with a **Forbidden zones** layer toggle (on by default, offered only when the map has any); they are read once when the dashboard opens, so zones saved from another console show after a reload. Gated on `GET /api/v1/robot/state` — no state, no panels. A motor above 85 °C raises **A motor is overheating** in the viewport's bottom-left corner, naming the hottest joint by the motor grid's own codes and its temperature (`MotorHeatAlert`, rule in `lib/robot/heat-alert.ts`). It has no timer: it stays until it is dismissed or the motor cools, and once dismissed it comes back only after the motor has fallen under 80 °C and crossed 85 °C again, so a joint hovering at the limit does not flicker it. While a job drives on the waypoints' map, placing, repositioning and deleting a waypoint are greyed with the reason (see the run lock under `/maps`), and a pick armed when the lock arrives is disarmed; a goal (dragged on the map or a stop's **Move**) is held while the active map's floor plan is being rebuilt. |
| `/mapping` | Mapping mode: switch `AUTO`/`MANUAL`, press **Start mapping** with the robot standing still (the robot comes up in mapping mode building nothing), drive it around from the masthead's drive panel, watch pgo's "map so far" stream, save the map — which ends the run and leaves the robot idle for the next Start — and watch its 2D grid build, or discard the run mid-way and start a new map. The rail offers only what the robot's run state (`GET /api/v1/mapping`, polled while in Mapping) would accept. The page owns the confirmation rule and drives a single alert dialog from it: **every** act that rebuilds or discards something is confirmed, including a plain mode switch in either direction (it tears the stack down for ~30 s and stops whatever the robot was doing), and losing an unsaved run is what escalates the copy and turns the confirm button red; a start is the one press that needs no dialog, since it rebuilds and discards nothing. |
| `/maps` | The map library (`MapLibrary`): catalogue cards, thumbnails, per-card gridmap state (and why a conversion failed), Rebuild-grid, inline Rename, Edit (a pencil tile that opens the floor plan editor, greyed while there is no floor plan or one is being rebuilt) and Delete as an X, side by side in the card's top-right corner (Rename and Delete are greyed on the map in use — the backend refuses them too; Edit stays open on it, since a floor plan saved onto the live map is reloaded in place; Delete confirms in an alert dialog that names the map and counts the vertices and megabytes going with it), and **Switch**, which is what un-greys the other two. Switch is the card's top-left corner tile, in the same slot as the in-use badge and never shown beside it: a solid check where the robot is, swap arrows on every map it could move to. (Not an unfilled check — that reads as "already done, greyed out", which is a state this control genuinely has for maps it cannot switch to.) It is a live call — it re-points the running localizer and map_server and rewrites the instance INI, no stack restart — and its alert dialog carries the one consequence an unlabelled arrow cannot: the pose resets to the new map's origin, so set an initial pose on the dashboard afterwards. All three controls hand their result sentence up to one line above the grid. **Export**, beside Edit on every card (the map in use included), downloads the map directory and its waypoints as `<name>.zip` (`GET /api/v1/maps/{name}/export`); **Import**, the one button above the grid (shown even when the robot has no maps), takes such an archive (`POST /api/v1/maps/import`, the file as the raw body) and confirms in an alert dialog with a **Save as** field pre-filled from the filename — leave it empty to keep the name saved inside the archive. A name already in the catalogue turns the confirm into a red **Replace**, because the backend overwrites that map and its waypoints rather than refusing (it still refuses for the map in use, one mid-conversion, or one a task template targets). Its result sentence lands on the same line. **A map a job drives on is read-only for the job's length**: while any running job names a map (`map_name` in `GET /api/v1/active_tasks`), its Rebuild and Edit are greyed with the reason as their tooltip, and the floor plan editor holds every write on it (below). The backend is the gate — it refuses those writes with `task_running` for every console and for a schedule nobody here started — and the console only greys the controls first, read off the shared active-task poll and keyed on the job's map, never on which map is active. While that poll is loading or failing the map is treated as locked, because an unknown read as idle is how an edit lands under a moving robot. |
| `/maps/[name]/edit` | The gridmap editor — replaces a step that used to be done in GIMP. `?mode=vertex` opens it with **Waypoint** chosen and `?from=tasks` points its back button at the task editor; both are what the task editor's link sets. Its title renames the map in place: double-click it (or press F2 on it) and Enter saves, Escape cancels — no button, and refused outright while the gridmap is dirty, since a rename moves the directory and the reload that follows would drop the buffer. Its controls are two icon strips along the top, as on the dashboard. The right one is a **Draw** list — No type, **Wall**, **Floor**, **Unknown**, **Waypoint** or **Forbidden zone** — beside Zoom out / Zoom in; it opens on No type, so a press only drags the map. The left one holds Fit to view, Undo / Redo, Save (an icon, with a dot while there is something to save) and then the tools: Pan always, and after the chosen kind's mark either Brush, Line, Rect and a brush Size for cells, **Place** and **Select** for waypoints, or **Shape**, **Done** and **Remove** for a forbidden zone. Every change of Draw choice lands on Pan. **Place** stages a waypoint where you press (drag to aim it), **Select** drags a box over several, with Shift-click (or a tap, on a phone) to add to the set and a Delete for the whole band. The save note hangs under the left strip and the waypoint panel under the right one. On a phone the strips stack at the top and the waypoint panel sits at the bottom, two fingers zoom and pan the map, and the ± do the same one step at a time. Choosing No type, or Escape, puts the choice down. **Forbidden zone** dims the map and asks "Select the shape to work with" under the left strip until **Shape** is armed; then every click on bare map is a corner, the corners stay on screen and any of them can be dragged to reshape the shape in flight (it swells under the pointer), the shape closes on a click back on its first corner (lit once there are three), on Enter or on **Done**, and Escape drops the shape in flight before it drops the choice. Every finished zone shows a handle on each corner while Shape is armed: dragging one (with nothing in flight) reshapes the zone, and clicking one *attaches* the shape to that zone — as its first corner, or as the next corner of a shape begun on bare map that has reached the zone. Click another corner of the same zone and the shape's own corners replace that stretch of the zone's edge (whichever of the two stretches leaves the larger zone), which is how a zone grows a room or loses a notch without being redrawn. A click inside a finished zone selects it (drawn heavier), Shift-click (or a tap, on a phone) adds others to the selection, and **Remove**, Delete or Backspace takes every selected zone away at once — off the robot too, straight away and without Save (it sends the last saved list minus those zones, so edits not yet saved stay waiting for Save; a zone the robot never had sends nothing, and one the robot refuses to drop comes back on screen with its reason). Zones are drawn as a red wash and are the map's own: the editor opens with the zones the robot holds, and **Save** writes the whole list back (`PUT /api/v1/maps/{name}/keepout`) beside the cells — whichever of the two has changes, each with a note of its own, and on the map the robot is on the planner keeps to the new zones at once. If the zones cannot be read, **Forbidden zone** is greyed out with the reason under the left strip and the floor plan stays editable, because a list saved over one never read would erase it. A shape still in flight is not a zone yet and is not saved. A stop you mark by driving to it instead comes from **Use robot position**. The robot's own footprint is drawn (to scale, `signal-live`, in both modes) wherever it is standing — both it and the button are offered only while the robot is localized on *this* map, and the button names the reason when it is not. The other half of that button — driving to the stop you are about to mark — is the masthead's drive panel, which this editor no longer mounts itself; the panel comes up disarmed and its WASD/QE set does not collide with the editor's Space / 0 / Ctrl+Z. While a job drives on this map (the run lock under `/maps`), Save, placing, moving and deleting waypoints and removing a forbidden zone are held, with the reason on screen; strokes, shapes and a typed name stay in the editor and can be saved once the job ends. |
| `/recordings` | Bag recording: start a `ros2 bag record` on the robot, watch it grow, and manage what is on disk. The recorder panel has two faces rather than one with disabled fields — idle asks what to record (name, topic chips defaulting to the LIO inputs, compression on), live reports the elapsed clock, bytes written and resolved topic names — and which face is shown comes from `GET /api/v1/recordings/active`, not from a local "we pressed Start" flag, so a recording started from a shell or a second console is shown correctly and one that died is reaped within the second. The list below is every bag on the robot, newest first, with the live one still in it. Each row shows its size and nothing else it measures; a bag that did not close cleanly carries a No index chip. A finished bag with zero messages is called out, because nothing refuses a topic that does not exist (the recorder waits for it, so it can be armed before bringup) and a typo is otherwise silent. Delete is the row's X, behind the map library's alert dialog, and is refused for the live recording. |
| `/settings` | Preferences (theme, waypoint labels, language) + wifi (`nmcli` through the backend), and, in the header's top right, a red **Restart** that rebuilds the robot's software in the mode it is already in (`POST /api/v1/robot/restart`), behind a confirm that warns when a job is running. Only offered in Navigation — the backend refuses Mapping, whose unsaved map lives in memory — and while the link is up. The outcome is read from `GET /api/v1/robot/restart`, polled only while it says `restarting` (~30 s) — not from `/robot/state`, which keeps answering with the last frame through the rebuild. The hint under the button says it is restarting (whichever console started it), then **Restart complete. The robot is back in Navigation.** or the robot's reason for failing, to the console that pressed it. |
| `/tasks` | Task overview: the saved jobs, the registered schedules and any run in progress. **Create task** (top right) opens the editor on a new job, asking first when unsaved steps would be cleared; a row's Load opens it on that job, asking the same when it would replace unsaved steps from another one. A row's Run dispatches it from here, and its **Schedule** opens the trigger form at the top of Registered schedules, where the new schedule appears; only a saved job can be scheduled. A row with schedules carries a clock chip that says how many and how many are paused (`3 schedules · 2 paused`, or a lone one's trigger); pressing it scrolls to that job's schedules and lights them for a moment. Every job is listed whichever map it is for: one for another map is marked, its Run and Schedule are held, and Load opens the editor on that map. **Schedules.** One Repeat picker — Daily, Weekdays, Weekends, Custom (the seven day toggles), Interval (a count in minutes or hours) — plus a clock time. Cron is never typed and never shown: it is built on the way out and read back as a sentence on the way in, and a cron this console could not have written is shown verbatim rather than as a sentence it does not mean. A preview line built from the same description the list renders says what will be registered, with its next run, before anything is sent. **Next run** is on the operator's own clock (UTC only in the server render, labelled as such, until the browser says which clock that is). The list is not polled — the soonest run in it is the one moment it goes stale on its own, so it re-reads itself just after that, and a row steps over a run that has already fired rather than going on naming it as the next one. A Run sends the map the job was planned on (`map_name`), so a map switched since the list was read is refused by the backend (`map_mismatch`) rather than driven on the map that replaced it; a row's Run is also held, with the reason under it, while its map's floor plan is being rebuilt. |
| `/tasks/editor` | Task editor: the step list, under a heading that is the job's name. It neither runs nor schedules a job — both are a saved job's row on `/tasks`. The heading's settings button (**Rename task**) turns it into the name field: Enter confirms, Escape backs out. A saved job is renamed at once, by name alone, so step edits not yet saved stay unsaved. The header holds **Go back**, which returns to `/tasks` and leaves the draft as it is, **Save**, which updates the loaded job or creates one — asking for a name in the heading first if it has none — after which the new one is the loaded one, and, to its right while a saved job is loaded, **Delete**, which removes it behind a confirm (naming any schedules of it, which keep running) and returns to `/tasks`. **Steps.** A step row folds to a one-line readback of what was typed, and folded is the default — a twenty-step patrol unfolded is three screens of inputs, and a template loaded to be reviewed or reordered wants the summary. A row just added opens for filling in; a row that is unfinished shows its problem on the folded line and stays open. Reorder by the row's drag handle or its move menu (top, bottom, one either way); the step ids are positional, so the order shown is the order posted. A Move step is set by picking a waypoint and nothing else — there are no coordinate fields, so when the job has no map, the map has no waypoints, or they cannot be read, the row says what to do on the floor plan instead and stays unsendable. The **Map** picker on the Steps group says which map those waypoints come from: it opens on the map the robot has loaded, and can be pointed at any other so a job for the second floor can be built while the robot is on the first — switching clears the waypoints already picked, behind a confirm, since they belong to the map they were picked on. A job for a map the robot is not on can be saved but not run or scheduled until that map is loaded; the Steps group says so. The map button beside a Move row's waypoint picker opens the job's floor plan under that picker, every waypoint marked by name and the ones the job's Move steps go to lit with their step numbers, because a name in a list is not a place. It is a view, not a picker — a waypoint is set on its row — and it zooms with the wheel, a pinch or its Zoom buttons, pans by dragging, and comes back to the whole map with **Fit to view** or a double-click; zooming out stops at that view. It is closed by default, and each Move row keeps its own open or closed across folding. The pin button beside the Map picker opens that map's editor in Waypoints mode, for the stop the job turned out to need, and that editor's back button returns to this one. **What is in the editor stays in the tab**: the steps, the loaded template, the map choice and a new job's name survive that trip, a walk back to /tasks and a reload, and go away with the tab, when Create task is confirmed, or with Delete — they are unsaved work, not something on the robot. |
| `/history` | Job history: finished runs from `GET /api/v1/task_history`, newest close first. Above the list, how the jobs in the chosen window ended — finished / completed / failed / canceled, a success rate, and one bar of everything finished split by outcome — from `GET /api/v1/task_history/stats`. A toolbar of four pickers scopes it: a time window (last 1 / 6 / 24 h, or a custom range typed on the operator's clock and sent as UTC), outcome, kind (navigation goal, stand, lie down, task, scheduled) and the template's name, with a Reset once anything is narrowed. The outcome narrows the list only: the dashboard is read without it, so it stays how the window's jobs ended rather than a tautology about the rows, and says under its tiles which outcome is listed. The filter lives in the address bar, so a view can be bookmarked or sent. Previous / Next paging: the endpoint only pages forward and has no total count, so the console keeps the cursors it was handed to step back, and shows "Page N" without an "of M". Ten jobs per page. Each row is titled by the template it ran, else by its kind, and only by the job id for a run nothing labelled; who started it (a schedule or directly) is under it, and the id and the per-step results, read from `GET /api/v1/tasks/{id}`, appear only when the row is opened. There is no poll; the list and the counts are refreshed when a run drops out of the console's active-task poll. It reaches back only as far as Temporal's retention. |
| `/webrtc-test` | The WHIP/WHEP bench — unlisted (no nav rail entry, opened by hand) but built into every image, because the robot only ever runs a production build and that is the one machine where the video path can be tested. The only consumer that exercises WHIP. |

On a phone (below `lg`) the nav rail is a bottom bar of seven equal icon-only
tabs, the masthead's drive panel and camera window anchor to the viewport
rather than to their buttons, every control is 40 px under a coarse pointer,
and the two canvases take a finger as one pointer: a second finger pinches the
floor plan or abandons a pose being placed, never a second press. A tap does
what a double-click did — opens a stop's dialog on the dashboard, puts a
floating panel back when it lands on the grip. `CLAUDE.md` has the rules.

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

Below `sm` the strip is **two rows**: the id, mode, drive, camera and battery
on the first, the job's buttons and bar across the full width of the second.
One wrapping flex row rather than a second copy of the component — rendering
it twice and hiding one would put two pause buttons and two live readouts in
the accessibility tree.

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
