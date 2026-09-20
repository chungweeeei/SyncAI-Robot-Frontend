---
name: backend-endpoint
description: >
  End-to-end procedure for adding or changing a backend interaction in this
  console — fetcher, zod schema, query key, hook, cache invalidation, component
  wiring and a test. Use when touching anything that talks to syncai_backend.
metadata:
  origin: project
---

# Adding a Backend Interaction

Every REST call in this console crosses four layers in a fixed order. The
layering itself is enforced by eslint, so you cannot get the *direction* wrong.
What eslint cannot catch is the two things below, which is why this skill
exists — both produce a green `lint`, `tsc`, `build` and test run:

1. **A write that does not invalidate every key its response affects.** The
   screen keeps showing a stale answer until something else happens to refetch.
   Renaming a map changes `taskTemplates`, not just `maps`; nothing will tell
   you if you forget.
2. **A zod schema that drifts from the interface it mirrors.** Only the
   `z.ZodType<T>` annotation makes a missing field a compile error. Write
   `const S = z.object({...})` without it and a forgotten field compiles,
   validates, and arrives as `undefined` pages later.

## When to Activate

- Adding a new endpoint to `lib/api/*`
- Adding a hook that reads or writes the backend
- Changing a response shape, or reacting to a backend field that was added
- Reviewing any of the above

## The order

| # | Step | File |
| --- | --- | --- |
| 1 | Wire types + zod schema | `lib/api/<router>.ts`, or `lib/types/` if shared |
| 2 | Fetcher | `lib/api/<router>.ts` |
| 3 | Query key (reads only) | `lib/api/query-keys.ts` |
| 4 | Hook | `hooks/use-*.ts` |
| 5 | Cache consequences (writes only) | the hook's `onSuccess` |
| 6 | Component wiring | `components/<feature>/` |
| 7 | Test | `lib/**/*.test.ts` or `e2e/` |

Do them in this order. Steps 3 and 5 are the ones people skip.

---

## 1. Types and schema

The interface is the source of truth; the schema mirrors it. Field names stay
**snake_case** — these are a pass-through of the backend's own names, not a
rename table, and a rename layer is a second place to get them wrong.

```ts
export interface RecordingSummary {
  name: string;
  status: RecordingStatus;
  duration_seconds: number | null;  // null until the recording finishes
  topics: string[];
}

// The annotation is load-bearing: drop a field and this line stops compiling.
const RecordingSummarySchema: z.ZodType<RecordingSummary> = z.object({
  name: z.string(),
  status: z.enum(["recording", "ok", "interrupted"]),
  duration_seconds: z.number().nullable(),
  topics: z.array(z.string()),
});
```

- `z.object` strips unknown keys, so the backend **adding** a field is not a
  breaking change. Only a rename or a type change fails.
- Distinguish `.nullable()` (the backend sends `null`, a real answer) from
  `.optional()` (the key may be absent). Getting this wrong is the most common
  schema bug here.
- A type more than one router shares goes in `lib/types/`.
- Put the schema directly under the interface it mirrors, not in a schemas file.

## 2. Fetcher

Two doors only: `requestJson` for JSON, `requestRaw` for anything else (the
gridmap image, the map point cloud). **Never call `fetch` directly** — that is
how a refusal stops being the backend's sentence. `lib/video/` is the one
permanent exception and stays one.

```ts
export function fetchRecordings(signal?: AbortSignal): Promise<RecordingSummary[]> {
  return requestJson<{ recordings: RecordingSummary[] }>(
    apiUrl("/api/v1/recordings"),
    { signal, schema: z.object({ recordings: z.array(RecordingSummarySchema) }) },
  ).then((body) => body.recordings);
}
```

- **`apiUrl()` always.** Never a hardcoded host — see `lib/api/config.ts`.
- **Reads pass `schema`. Writes do not**, because the request shape is already
  closed by the request types. But a write's *echo* is validated wherever it is
  spliced into the cache (`startRecording` passes one for exactly this reason).
- `parse: false` for a 204 or an envelope nothing reads.
- Take `signal` on anything a query calls, and pass it through.

### When the UI branches on a refusal

Only then. `mapError` turns a `code` into a typed error; everything else wants
the plain `Error` carrying the backend's sentence.

```ts
mapError: ({ detail, code }) =>
  code === "gridmap_hand_edited" ? new ConvertConflictError(detail, code) : undefined,
```

Two endpoints do this today (grid convert, map activate). If you are reaching
for a third, check the control actually *branches* — showing the sentence is
not branching.

## 3. Query key

One object, `lib/api/query-keys.ts`, documented per key. **Never inline a key.**
The file is where cache *sharing* is visible: `mapVertices(name)` is read by
both the editor and the dashboard on purpose, so a waypoint moved on one is
already current on the other.

Before adding a key, ask whether an existing one already answers this. Before
folding a new read into an existing key, ask what it costs — `activeRecording`
is deliberately separate from `recordings` because the catalogue walks every bag
directory and the live entry is one slot in memory.

## 4. Hook

One hook per backend interaction. This is the **only** place a component gets
data or performs a write.

### Read → `useQuery`

```ts
export function useRecordings(): UseRecordings {
  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.recordings,
    queryFn: ({ signal }) => fetchRecordings(signal),
    refetchInterval: (query) => pollWhileRecording(query.state.data),
  });
  return {
    recordings: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
  };
}
```

**Polling policy — poll only while the server is changing something on its
own, and let the status that triggered the poll switch it off.** `useMaps`
polls while `grid_status === "converting"`; `useRecordings` polls while a bag
is live. A poll with no off-switch is a bug. Anything this console does itself
(start, stop, delete) invalidates instead.

The two console-wide polls — `RobotStateProvider` (1 Hz) and
`ActiveTaskProvider` (2 s) — are mounted once in `app/layout.tsx`. Read the
provider; never start a second `robotState` poll.

Expose a three-state `status`, not a raw boolean: `null` from the server and
`null` before the first response are different answers, and a panel that
cannot tell them apart flashes its empty state on mount.

### Write → `useMutation`

Grouped by router (`use-map-actions.ts`, `use-recorder.ts`, …), one hook per
write. Do not add a local `busy`/`error` state to the component — the mutation
already has `isPending`, `error.message`, `data` and `reset()`.

A hook that owns three or four writes on one resource (`use-map-vertices`,
`use-task-templates`, `use-schedules`) exposes **one** `busy`/`error` pair
rather than one per verb, folded by `writeState` from
`lib/api/mutation-state.ts`. A component wired to such a hook reads one flag
and one sentence:

```ts
const { busy, error } = writeState([create, update, remove]);
```

### Command → `useMutation` that invalidates nothing

`use-goal-task`, `use-posture`, `use-locomotion`, `use-mode-switch`,
`use-initial-pose`, `use-wifi-connect`. There is no cached resource a motion key
makes stale. They compose a *reader* instead: `useTaskTracker` for a dispatched
task, the shared robot-state poll for the two that command the machine directly.

**Read the epistemics note in `use-locomotion.ts` before adding one.** A request
is not a reading, and which of the two a value is decides whether it may be
shown as fact. This is why the initial-pose control says "Sent" and not
"Applied".

## 5. Cache consequences — the step that gets skipped

The hook-level `onSuccess` owns **every** key the response affects, not only the
one the data was fetched under. List them explicitly, each with the reason:

```ts
export function useRenameMap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }) => renameMap(from, to),
    onSuccess: (_result, { from }) => {
      // Keyed by the old name; nothing will read it again.
      queryClient.removeQueries({ queryKey: queryKeys.mapVertices(from) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.maps });
      // `templates_moved`: the task console scopes its library on `map_name`.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates });
    },
  });
}
```

Known cross-key edges in this codebase:

| Write | Also invalidates | Why |
| --- | --- | --- |
| map rename | `taskTemplates` | templates carry `map_name` |
| map activate | `taskTemplates`, `mapVertices` (both maps) | `map_matches_active` flips on every template |
| vertex CRUD | `maps`, `taskTemplates` | vertex counts, template resolution |
| recording start/stop | `recordings` **and** `activeRecording` | one event changes both faces |

Three rules for this block:

- **Not awaited.** An awaited refetch unmounts a deleted map's card before its
  own callback can run.
- **`setQueryData` when the response *is* the next value** of a key
  (`startRecording` returns exactly what `GET /recordings/active` would say), so
  the panel switches on the press rather than a poll later.
- **`removeQueries`, not invalidate**, for an entry nothing will read again —
  a per-map cache keyed by a name that no longer exists.
- Hook-level `onSuccess` fires even if the caller unmounted. **UI reactions**
  (close the dialog, hand the sentence up) belong in the per-call
  `mutate(vars, { onSuccess })`, which only fires while mounted.

## 6. Component

```tsx
const remove = useDeleteRecording();

const submit = () =>
  remove.mutate(recording.name, { onSuccess: () => setConfirming(false) });

// Render the backend's sentence verbatim. Never wrap or rephrase it.
{remove.error && <p role="alert">{remove.error.message}</p>}
```

- Importing a **value** from `lib/api/*` into `components/` or `app/` fails
  lint. `import type` is fine; `lib/api/config` is exempt.
- `reset()` where you would previously have cleared a local error — and in
  `onMutate` if a previous failure would otherwise show during a new attempt.
- `mutateAsync(…).catch(ignore)` is the house idiom for a handler wired
  straight to a button; the rejection is on the mutation, which is where the UI
  reads it.
- **On-screen copy follows the operator-copy rules in CLAUDE.md's Conventions.**
  A new error string must not name a ROS topic, a node, a file, or a vendor.

## 7. Test

- **Rule in `lib/`** → vitest, next to the file. Test the *rule* the code has
  to keep, not the implementation: an added backend field must not break the
  schema; `normalizeTheta` never returns -180 because the backend rejects it.
- **A button that does something to the robot** → playwright, with a fixture in
  `e2e/backend.ts`. Assert **both halves**: what the screen says *and* what the
  console sent. A build that posts to the wrong endpoint passes a screen-only
  test.

Fixtures are written from the same interfaces the schemas mirror, so a drifted
fixture fails at the schema boundary instead of passing quietly.

---

## Checklist

- [ ] Schema annotated `z.ZodType<T>`, `.nullable()` vs `.optional()` correct
- [ ] Fetcher goes through `requestJson`/`requestRaw` and `apiUrl()`; reads pass
      `schema` and take `signal`
- [ ] Key in `query-keys.ts` with a comment; nothing inlined
- [ ] Poll (if any) turns itself off via the status that started it
- [ ] **Every** key the write affects is in `onSuccess`, each with its reason
- [ ] UI reactions in the per-call `onSuccess`, cache consequences in the hook
- [ ] Component reads `isPending`/`error.message`, renders the sentence verbatim
- [ ] New copy passes the operator-copy rules
- [ ] A test that would fail if the endpoint or the shape changed

## Verify

```bash
npx tsc --noEmit && npm run lint && npm test && npm run test:e2e && npm run build
```

Remember what none of these prove: that the backend really answers in this
shape. The schema is the boundary where that assumption becomes an error
instead of a blank readout.
