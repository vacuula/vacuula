# Robot name editor regression coverage

From `app`, with dependencies installed:

```sh
node --test tests/settings-name.test.cjs tests/name-save-provider.test.cjs
pnpm exec vite build
```

These offline tests execute the actual Settings, Input, and AppProvider TSX with hook, HTTP, EventSource, and presentation boundaries mocked. They cover draft retention during inventory refresh, blur/Enter commit, blank names, failed-save feedback and retry, robot switches, stale inventory after an optimistic save, and serialized overlapping saves for both robot generations. They do not establish browser or device acceptance.

This PR does not include the inventory selection preservation from PR #85. On upstream main, unrelated inventory events can still remount the selected robot while the editor is open. PR #85 is needed for complete prevention of those remounts; apply it as a separate change. Applying PR #85 afterward conflicts in `AppContext.tsx`: retain one `robotRef` and one `selected` binding, and retain both the name protection and selection reconciliation. The resolved AppContext and other shared source files must match the tested combined source. The combined source was tested in the local UI trial, but this standalone patch has only offline and build qualification.
