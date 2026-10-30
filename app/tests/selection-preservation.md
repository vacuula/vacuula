# Inventory selection regression coverage

From `app`, with dependencies installed:

```sh
node --test tests/selection-preservation.cjs
pnpm exec vite build
pnpm exec tsc -b --pretty false
```

The 25 tests transpile and execute the actual `AppProvider` TSX. A deterministic hook adapter preserves state/refs across renders and runs effects with dependency comparison and cleanup. HTTP, command responses, EventSource, map loading, storage, theme, and presentation imports are mocked. Unknown imports fail closed. No browser, HTTP client, server, or robot is started.

Both Gen3 and Gen4 cover saved/first-online initial selection, explicit switching, identical inventories, unrelated disconnect/removal/addition, selected disconnect/removal with or without fallback, reconnection after no online robots, first connection after empty startup, and selected-stream reopen. Inventory preservation asserts object identity, no intermediate undefined selection, updated inventory, no extra state/map requests, and no stream churn. Switching and selected loss still run the existing stream cleanup.

To run the identical tests against an original source file, without editing this checkout:

```sh
SELECTION_SOURCE=/absolute/path/to/original-AppContext.tsx node --test tests/selection-preservation.cjs
```

The original 20-test suite at upstream `7dbee4c0467873e75484f9ac72bbdf90392ff535` had 14 pass and 6 fail: both generations failed unchanged-selection preservation and clearing after selected disconnect/removal without fallback. The first candidate passed those 20 tests but introduced stale selected metadata.

The expanded 25-test suite was run RED against candidate `509ec639b1e036301dcdb8c5d79f5d2d20bebdc0` before the metadata repair: 20 passed and 5 failed. Failures were incoming selected names in both generations, Gen4 `label_serial`, and selected type identity changes in both directions. After the repair, all 25 pass. Metadata cases queue a fresh telemetry event without rendering before the inventory event, requiring the functional update to preserve the latest state, action, details, commands, and alerts/errors. They also require unchanged serial/type, no transient clear, no state/map refetch, no stream reset, and stable object identity on repeated metadata. An omitted optional inventory `label_serial` retains the selected robot's known label rather than invalidating its required label. A changed type is an identity change and uses the existing reconnect path instead of merging incompatible telemetry.

Vite bundling passes, with its chunk-size warning. Full TypeScript checking remains blocked by existing diagnostics: upstream had 56, the first candidate had 55, and this repair has the same 55. After normalizing source positions, there are no added or removed diagnostics relative to the first candidate. Relative to upstream, the only removed diagnostic is the previously unused `useRef` import.

This is offline provider characterization, not native React/browser lifecycle or hardware acceptance. It does not establish actual browser draft loss. Existing unresolved-request races, including inventory events during initial state fetching and late responses after explicit switches, are not changed or qualified by this fix. No server connection-cleanup logic is added: PR #78 changes server disconnect handling, and PR #83 changes Home Start behavior, in separate files.
