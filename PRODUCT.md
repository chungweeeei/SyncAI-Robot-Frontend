# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **FAE (field application engineer) — the primary user.** Commissions a
  robot at a customer's site: builds and resumes maps, edits the 3D map
  (ground patches, waypoints, forbidden zones), composes and schedules
  tasks, tunes planner and controller settings, and pulls logs when
  something goes wrong. Most of this is done on a laptop beside the robot;
  a phone is used to drive and watch while walking with it.
- **The customer — sometimes.** The FAE at times hands the console to the
  customer or shows it to them. Whatever the customer sees has to read as a
  finished product and make sense without the FAE explaining it.
- **Internal PMs.** Use the console to watch the robot, check how jobs went
  (history, success rate) and judge the product.

Open: whether a customer operates the console on their own day to day
(watching patrols, pressing the stop, driving) or only watches it while the
FAE is there.

## Product Purpose

The operator console for one SyncAI quadruped robot (G23): watch its
telemetry and cameras, drive it, build and edit the maps it navigates on,
and dispatch, schedule and review its jobs. It is a browser client of the
robot's own backend (`syncai_backend`), served from the robot, so nothing is
installed on the operator's machine. Success is an FAE commissioning a site
alone, end to end, in this console, and a customer or PM understanding what
the robot is doing at a glance.

## Positioning

Inferred from the codebase, not yet confirmed by the user:

- One console per robot, reached over the site's LAN, with no cloud and no
  fleet layer.
- Navigation on 3D maps that span several floors (floor bands, stairs, a
  route across storeys) is the core capability, rather than a flat 2D map.

Open: what the differentiator is against competitors, and whether the
console will ever manage more than one robot.

## Operating Context

- Industrial sites (factories, warehouses), on the robot's LAN, often with a
  weak or busy Wi-Fi link that the console's own requests may cross.
- A laptop for commissioning work (the map editor and task editor are built
  for it); a phone (375 px and up, coarse pointer, sometimes held sideways)
  for driving and watching beside the robot.
- Sessions can last a long time: an operator may watch a patrol for an hour
  without pressing anything, and the emergency stop must still work then.
- The console sits beside a robot that moves: an error, a stale reading or
  an unclear state can cause physical harm, not just a bad screen.

## Capabilities and Constraints

- The routes and features are documented in `README.md` (routes table) and
  `CLAUDE.md` (directory map). Product facts there are authoritative.
- **On-screen words are for FAEs and customers, never the stack.** The house
  vocabulary in `CLAUDE.md` § Conventions is binding: scan, 3D map, ground
  patch, floor (1F / 2F), waypoint, forbidden zone, channel, recording,
  clip, Mapping / Navigation, job, success rate. No ROS, file, algorithm or
  vendor names on screen.
- Backend refusals are shown verbatim; they are already written for
  operators.
- The emergency stop is on every screen and no failure may take it down.
- A request is not a reading: the UI must never show a commanded state as
  fact before the robot reports it.
- One account (`admin`); no roles or permissions in the UI.
- UI copy is English only today. Open: whether other languages are needed.

## Brand Commitments

None on hand. The repository holds no SyncAI or G23 logo, brand palette or
voice guide (`public/` has only framework placeholders). Open: whether
official brand assets exist and must be followed. Do not invent a logo or
brand mark.

## Evidence on Hand

- The robot's real 3D model: `public/models/g23.glb` (baked from its URDF).
- No customer names, case studies, testimonials or metrics exist in the
  repository. Do not fabricate any.

## Product Principles

1. **Safety outranks everything on screen.** The stop is always reachable,
   and the robot's real state is never blurred with what was asked of it.
2. **One FAE can do the whole job here.** Commissioning a site should never
   need a terminal, a second tool or someone back at the office.
3. **Customer-presentable at any moment.** Any screen may be shown to a
   customer, so it must be finished, plain-spoken and free of engineering
   leftovers.
4. **Say what is true, plainly.** Empty, loading, failed and unknown states
   are stated rather than left blank or guessed.
5. **Works where the robot is.** A phone by the robot and a laptop on a
   flaky site network are normal conditions, not edge cases.

## Accessibility & Inclusion

No product-specific standard has been set. Existing practice in the code:
40 px touch targets under a coarse pointer, 16 px inputs on touch, reduced
motion respected, keyboard paths for drag-and-drop. Open: requirements such
as gloved use, outdoor glare or colour-vision deficiency.
