# Schedule regression tests

From `app/`, install the locked dependencies and run:

```sh
pnpm install --frozen-lockfile
pnpm test
```

The tests use jsdom and exercise the real Gen3 Schedule page, shared inputs,
drawer, and command serializer. Only the robot context, map loaders, and HTTP
transport are replaced with synthetic fixtures; no server or physical robot is
contacted.

The transport fixture returns the Gen3 `boundary: { id, name }` read shape and
accepts zone assignments only through `boundaryId`, so roundtrip tests catch
silent zone loss. The suite also covers validation, midnight, deselection,
rejected and failed commands, delayed firmware readback, retry without duplicate
writes, delayed zone loading, keyboard actions, and switching to Gen4.
