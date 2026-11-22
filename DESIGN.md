---
name: SyncAI Robot Console
description: The operator console for one quadruped robot, drawn as a glass cockpit
colors:
  well-day: "#e9eef2"
  panel-day: "#ffffff"
  elevated-day: "#e2e9ee"
  hairline-day: "#ccd6de"
  ink-day: "#0e161c"
  muted-ink-day: "#566772"
  signal-live-day: "#12784a"
  signal-cmd-day: "#0a6d94"
  signal-active-day: "#a13a86"
  signal-caution-day: "#93600e"
  signal-warn-day: "#c02f34"
  well-night: "#0b1014"
  panel-night: "#121a20"
  elevated-night: "#1b252d"
  hairline-night: "#24313b"
  ink-night: "#dbe4ea"
  muted-ink-night: "#7f929e"
  signal-live-night: "#4fd98d"
  signal-cmd-night: "#45c8f0"
  signal-active-night: "#e56ec6"
  signal-caution-night: "#f0b23c"
  signal-warn-night: "#f4595e"
  cmd-ink-night: "#06121a"
typography:
  headline:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.3
  title:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  nav:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  label:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1
  caption:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.25
  readout:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
  readout-id:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "tnum"
rounded:
  sm: "2.4px"
  md: "3.2px"
  lg: "4px"
  xl: "5.6px"
  full: "9999px"
spacing:
  hair: "4px"
  tight: "6px"
  base: "8px"
  row: "10px"
  group: "12px"
  section: "16px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cmd-day}"
    textColor: "{colors.panel-day}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.well-day}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-destructive:
    textColor: "{colors.signal-warn-day}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  input:
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
    typography: "{typography.body}"
  nav-item:
    textColor: "{colors.muted-ink-day}"
    rounded: "{rounded.sm}"
    height: "36px"
    typography: "{typography.nav}"
  nav-item-active:
    backgroundColor: "{colors.elevated-day}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.sm}"
    height: "36px"
  tone-chip-live:
    textColor: "{colors.signal-live-day}"
    rounded: "{rounded.sm}"
    typography: "{typography.label}"
  emergency-stop:
    textColor: "{colors.muted-ink-day}"
    rounded: "{rounded.sm}"
    size: "56px"
  emergency-stop-engaged:
    textColor: "{colors.signal-warn-day}"
    rounded: "{rounded.sm}"
    size: "56px"
  instrument-group:
    backgroundColor: "{colors.panel-day}"
    padding: "14px 16px"
  dialog:
    backgroundColor: "{colors.panel-day}"
    textColor: "{colors.ink-day}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "448px"
---

# Design System: SyncAI Robot Console

## Overview

**Creative North Star: "The Glass Cockpit"**

The console borrows an aircraft EFIS's colour semantics because they map onto a
navigation stack almost one to one. Colour is never decoration here: five
signal hues each name what a value *is* (measured, commanded, active guidance,
degraded, faulted), and they mean the same thing in the chrome as on the 3D
map. Everything else is a cool, quiet neutral ground that lets those five read
at a glance. The operator reads this screen the way a pilot reads a panel:
in short looks, often while the machine is moving.

Density is instrument-grade. Readouts are rows, not cards: a caption label,
a hairline and a tabular number, with the frame spending as few pixels as
possible. Surfaces are rectilinear, nearly square-cornered and flat, separated
by tone and hairlines rather than shadows. The 3D viewport is the recessed
"well" every panel sits around. Day and night are both first-class themes:
day is cool paper for an operator in a lit site or outdoors, night is hull
graphite for a dim one. Neither is the default the other was derived from.

Motion is functional and scarce: a sweep across the status strip once per
telemetry frame (proof the link is alive), a hold bar filling on the stop's
release, a climbing battery meter while charging. Every one of them stops
under reduced motion.

**Key Characteristics:**
- Five EFIS signal hues carry all meaning; neutrals carry everything else.
- One sans (Mona Sans) for words, one mono (JetBrains Mono, tabular) for every measured quantity.
- Corners of 4 px at most on anything rectangular; pills are the only round shape.
- Flat: tone steps and 1 px hairlines separate surfaces; shadows only lift overlays and things being dragged.
- Day and night are equal themes, switched from the nav rail's foot.
- Touch targets grow to 40 px under a coarse pointer, by CSS, at any width.

## Colors

A cool blue-grey neutral ground, paired day and night, under five signal hues tuned to clear 4.5:1 on their own theme's surfaces.

### Primary
- **Commanded Cyan** (day `{colors.signal-cmd-day}`, night `{colors.signal-cmd-night}`): a value the operator is committing — a goal pose, the primary action, focus rings, the active nav tick, the selected floor pill. It is the console's `primary`, so every default button is "a command".

### Secondary
- **Live Green** (day `{colors.signal-live-day}`, night `{colors.signal-live-night}`): measured and valid now — the robot's pose, a link that is up, the strip's telemetry sweep.
- **Guidance Magenta** (day `{colors.signal-active-day}`, night `{colors.signal-active-night}`): active guidance — a job in progress and what it is doing.

### Tertiary
- **Caution Amber** (day `{colors.signal-caution-day}`, night `{colors.signal-caution-night}`): degraded but still working — a stale link, Mapping mode, a low battery, an assertion about the world rather than a command.
- **Fault Red** (day `{colors.signal-warn-day}`, night `{colors.signal-warn-night}`): faulted or forbidden — the emergency stop, a failed job, a forbidden zone, a refusal. It is the console's `destructive`.

### Neutral
- **Well** (day `{colors.well-day}`, night `{colors.well-night}`): the page and viewport background, deliberately darker than the panels in day so the 3D view reads as recessed; pure white could not.
- **Panel** (day `{colors.panel-day}`, night `{colors.panel-night}`): the chrome — status strip, nav rail, instrument rail, cards, dialogs, popovers.
- **Elevated** (day `{colors.elevated-day}`, night `{colors.elevated-night}`): hover and pressed states, the active nav row, secondary and muted fills.
- **Hairline** (day `{colors.hairline-day}`, night `{colors.hairline-night}`): every border, divider and input stroke.
- **Ink** (day `{colors.ink-day}`, night `{colors.ink-night}`) and **Muted Ink** (day `{colors.muted-ink-day}`, night `{colors.muted-ink-night}`): the value and its label. Muted ink is for what a thing *is*; ink is for what it *says*.

The 3D map is coloured by a separate **height ramp** (`lib/theme/height-ramp.ts`: violet through blue, green and yellow to red, the robot's own viewer's ramp). It is data colouring, not a sixth signal.

### Named Rules
**The Meaning-First Rule.** Pick a hue by what the value *is* (measured, commanded, active, degraded, faulted), never by how it looks. A green that does not mean "measured and valid" is a bug.

**The One Language Rule.** Chrome and canvas share the same five hues. A token moved in `app/globals.css` is moved in `lib/theme/signal.ts` in the same change, because a canvas cannot read a CSS variable.

**The Ramp Is Not A Signal Rule.** The height ramp never stands in for a signal, and no signal hue is used to colour heights: a floor two storeys up must not read as a command or a fault.

## Typography

**Body Font:** Mona Sans (with ui-sans-serif, system-ui)
**Readout Font:** JetBrains Mono (with ui-monospace), tabular figures

**Character:** one plain, quiet industrial grotesque for words, chosen from a side-by-side of six pairings, and a mono for numbers whose tall, open digits keep a 0 apart from an 8 at 11 px.

### Hierarchy
- **Headline** (500, 1.25rem, 1.3): a page title in the settings frame and the larger screens; there is no display size.
- **Title** (500, 1rem, 1.375): a dialog's or a card's title.
- **Body** (400, 0.875rem, 1.43): running text, buttons, inputs.
- **Nav** (500, 13px): the nav rail's and the floating panels' labels — a size up from a label, since it is read once.
- **Label** (500, 0.75rem, line-height 1): the instrument label — what a readout or group is. Words, not caps.
- **Caption** (400, 11px): units, a group's source line, secondary metadata. The most used size in the console.
- **Readout** (JetBrains Mono 500, 13px, -0.01em, tabular): every measured quantity — poses, distances, percentages, timestamps. The robot id in the strip is the same face at 15px.

### Named Rules
**The Tabular Rule.** Every measured quantity is set in the readout face with tabular figures. A number that reflows as its digits change cannot be read at a glance, which is the only way this screen is read.

**The No-Caps Rule.** Labels are words in the sans at caption size, not condensed uppercase. Size and colour separate "what this is" from "what it says". Job ids are never uppercased: an uppercased id is a different string from the one an engineer greps for.

## Layout

The shell is fixed to the viewport (the body does not scroll): a status strip across the top, a nav rail down the left from `lg` (icons only at `lg`, labelled from `xl`, foldable by its corner button) that becomes a bottom tab bar below `lg`, and the screen between them. On the dashboard and the map surfaces the 3D view fills that screen edge to edge, with panels and tool strips floating over its corners; an instrument rail sits beside it on wide screens.

Spacing runs on Tailwind's 4 px step and is tight: 6–8 px gaps inside a control cluster, 10–12 px between rows, 16 px panel padding. The status strip is one wrapping row: below `sm` the job bar drops to a full-width second line out of the same markup, never a second copy.

Responsive behaviour is CSS only. Width breakpoints decide layout; `pointer-coarse:` decides target size (40 px under a finger, 24–32 px under a mouse, the compact map tool strips at 32 px icons) and input text size (16 px, to stop iOS zooming). One height variant, `short:` (max-height 30rem), handles a phone on its side: the map fills the screen and the pose card goes. Safe-area insets pad the strip and the bottom bar.

**The One Markup Rule.** A row that must become two rows wraps; it is never rendered twice behind `hidden` / `sm:hidden`.

## Elevation & Depth

Flat by default. Depth comes from three tone steps — the well below, panels on it, elevated fills for hover and selection — and 1 px hairlines between groups. Even the floating panels and tool strips over a map view are flat, framed by a hairline. Shadows appear only on what is laid over content for a moment: dialogs, sheets and menus, a card being dragged, and the thumbstick's knob. A dialog's backdrop is a 25 % black scrim with a slight blur.

### Shadow Vocabulary
- **Overlay** (`shadow-lg`): dialogs, alert dialogs, sheets, dropdown menus, and a step card while it is dragged (with a 40 % cyan ring).
- **Menu** (`shadow-md`): select and combobox popups, the schedule glance's popover, the thumbstick's well where it sits over the map.
- **Nudge** (`shadow-sm`): the selected pill in the floor picker, the thumbstick's knob.
- **Commanded glow** (`box-shadow: 0 0 10px 0` in 40 % Commanded Cyan): the thumbstick's knob while it is held — the one glow in the console.
- **Changed-field edge** (`box-shadow: inset 3px 0 0 var(--color-signal-cmd)` on a 6 % cyan tint; Fault Red when invalid): a settings row whose draft differs from the robot's value.

### Named Rules
**The Flat-At-Rest Rule.** A surface that sits in the layout — floating map panels included — never casts a shadow; only an overlay or something in the hand may.

**The Ring-Not-Shadow Rule.** Keyboard focus is a 2 px outline in Commanded Cyan, offset 2 px, never a shadow — a shadow is swallowed by the 3D canvas behind it.

## Shapes

Instrument faces are rectilinear. The base radius is 4 px (`--radius: 0.25rem`), and the scale derives from it: 2.4 px for the most common small controls (nav rows, chips, icon buttons, the emergency stop), 3.2 px for notices and lists, 4 px for buttons, inputs and dialogs. Pills (`rounded-full`) are kept for things that are a column of choices or a status dot: the floor picker, toggles, progress tracks, the active-tab tick. Borders are always 1 px hairline; a tinted border at 40 % of a signal hue marks a toned chip.

**The Four-Pixel Rule.** No rectangular surface rounds past 4 px. A soft, bubbly corner reads as a consumer app, not an instrument.

## Components

### Buttons
Quiet and exact: small, square-shouldered, and coloured only when they command.
- **Shape:** gently squared corners (4px), 32 px tall, 10 px side padding; `sm` 28 px and `xs` 24 px. All grow to 40 px under a coarse pointer.
- **Primary:** Commanded Cyan fill with white ink in day, dark cyan-black ink (`{colors.cmd-ink-night}`) at night. Hover drops the fill to 80 %.
- **Outline / Secondary / Ghost:** hairline stroke on the well, an elevated fill, or nothing, each gaining the elevated tone on hover.
- **Destructive:** never a solid red. Fault Red text on a 10 % tint (20 % at night), deepening on hover.
- **Press / Focus:** a 1 px downward nudge on press; focus is a 3 px ring at half-strength cyan. Disabled is 50 % opacity.

### Chips
- **Style:** caption-size label in a signal hue, 1 px border at 40 % of that hue, an 8 % tint behind. The neutral chip is hairline and muted ink.
- **Use:** a status, mode or tone attached to an item (the strip's mode chip, a map's 3D map state). Below `sm` the mode chip collapses to a dot in its hue.

### Cards / Containers
- **Instrument group (preferred):** not a card. A label row, then readout rows, separated from the next group by a hairline; 14 px × 16 px padding on the panel. A group of detail rather than of watching (the motor grid) folds behind a worded **Show / Hide** in its label row, and opens on its own when something in it needs the operator.
- **Card:** for library items (maps, tasks, saved networks) only — panel background, a 10 % ink ring instead of a border, 16 px internal spacing.
- **Notice:** the empty / loading / failed state of a list: a hairline-bordered panel box with an instrument label and a sentence. A list is never left blank.

### Inputs / Fields
- **Style:** 1 px hairline stroke, transparent on the panel (30 % input tint at night), 4 px corners, 32 px tall (40 px and 16 px text under a coarse pointer).
- **Focus:** the stroke turns Commanded Cyan with a 3 px half-strength ring.
- **Error / Disabled:** a Fault Red stroke and ring for invalid; an error line under the control carries the backend's sentence verbatim. Disabled is a filled, 50 % field.

### Navigation
- **Rail:** panel-coloured, 36 px rows at 2.4 px corners, 18 px icons, 13 px medium labels. Rest is muted ink; hover is a 60 % elevated fill; the current screen is an elevated fill with ink plus a 2 px Commanded Cyan tick on the rail's attached edge.
- **Foot:** under a hairline, the theme as a Light / Dark pair of keys in a recessed well (the pressed one raised), then Sign out.
- **Phone:** the same items become a bottom bar of 40 px tabs, labelled from `md`, with the tick under the active tab.

### Emergency Stop (signature)
The first of the strip's presses on every screen. A 56 px square, icon-only (octagon), the disclosure buttons' size and corners but framed in Fault Red at rest (a 35 % red border, red icon), so it reads as the stop before it is needed and never as the job bar's Cancel. Engaged it fills to a 15 % red tint with a 60 % red border. One press engages at pointer-down; release takes a one-second hold, shown as a red bar filling the button. It is never wrapped in a fault boundary and nothing that can fail sits between it and the layout.

**Stop line.** What the stop is doing is said in words, in a band under the strip (Fault Red headline, ink sentence, a 10 % red tint, a 30 % red top rule): *Stopping…* until the robot reports the lock, *Emergency stop engaged.* with how to release, *Releasing…*. A refused press is an alert in the same band carrying the backend's sentence, held until dismissed. The band exists only while the robot is not free to move.

### Status Strip (signature)
The masthead: robot id in the readout face (the link home) with its mode chip, the loaded map, the running job's bar (id muted from `xl`, the step's line, the run's state in words, never blank), then health readouts and the disclosure buttons. A 1 px live-green sweep crosses its bottom edge once per telemetry frame.

### Floor Picker (signature)
A pill-shaped column in a map view's top-right corner: All, then the top floor first, with a Commanded Cyan pill sliding to the floor on show (200 ms ease-out, none under reduced motion).

## Do's and Don'ts

### Do:
- **Do** choose a signal hue by what the value is, and use the same hue for it in the chrome and on the 3D map.
- **Do** set every number in the readout face with tabular figures.
- **Do** keep rectangular corners at 4 px or less and separate surfaces with tone and 1 px hairlines.
- **Do** design both themes; check the day theme in particular, since outdoor operators depend on it.
- **Do** give every state words: an empty, loading, failed or unknown readout says so (`No task message in queue`, `Job list unavailable`), never a blank.
- **Do** grow targets to 40 px with `pointer-coarse:` and input text to 16 px, in CSS.
- **Do** stop every animation under `prefers-reduced-motion`.

### Don't:
- **Don't** use a signal hue for decoration, branding or emphasis — a hue with no meaning dilutes the five that have one.
- **Don't** wrap a few readouts in a card; use an instrument group.
- **Don't** make a destructive button solid red, or use a shadow on a surface that sits in the layout.
- **Don't** set labels in condensed uppercase, or uppercase a job id.
- **Don't** add a hand-written `matchMedia` hook or render a row twice for phone and desktop.
- **Don't** use `window.confirm`; a delete is asked through the confirm dialog (Keep / Delete).
- **Don't** colour heights with signal hues or signals with the height ramp.
