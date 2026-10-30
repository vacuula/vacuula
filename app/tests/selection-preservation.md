# Inventory selection regression coverage

From `app`, with dependencies installed:

```sh
node --test tests/selection-preservation.cjs
pnpm exec vite build
pnpm exec tsc -b --pretty false
```

The 20 tests transpile and execute the actual `AppProvider` TSX. A deterministic hook adapter preserves state/refs across renders and runs effects with dependency comparison and cleanup. HTTP, command responses, EventSource, map loading, storage, theme, and presentation imports are mocked. Unknown imports fail closed. No browser, HTTP client, server, or robot is started.

Both Gen3 and Gen4 cover saved/first-online initial selection, explicit switching, identical inventories, unrelated disconnect/removal/addition, selected disconnect/removal with or without fallback, reconnection after no online robots, first connection after empty startup, and selected-stream reopen. Inventory preservation asserts object identity, no intermediate undefined selection, updated inventory, no extra state/map requests, and no stream churn. Switching and selected loss still run the existing stream cleanup.

To run the identical tests against an original source file, without editing this checkout:

```sh
SELECTION_SOURCE=/absolute/path/to/original-AppContext.tsx node --test tests/selection-preservation.cjs
```

At upstream `7dbee4c0467873e75484f9ac72bbdf90392ff535`, 14 pass and 6 fail: both generations fail unchanged-selection preservation and clearing after selected disconnect/removal without fallback. With the fix, all 20 pass. Vite bundling passes, with its chunk-size warning. Full TypeScript checking fails on both sources: baseline has 56 diagnostics and fixed has 55. After normalizing source positions, the only removed diagnostic is the previously unused `useRef` import; no new diagnostics appear.

This is offline provider characterization, not native React/browser lifecycle or hardware acceptance. It does not establish actual browser draft loss. Existing unresolved-request races, including inventory events during initial state fetching and late responses after explicit switches, are not changed or qualified by this fix. No server connection-cleanup logic is added: PR #78 changes server disconnect handling, and PR #83 changes Home Start behavior, in separate files.
