# Home Start regression coverage

After installing the app's dependencies with `pnpm install --frozen-lockfile`, run from `app`:

```sh
node --test tests/home-start.cjs
pnpm exec vite build
```

The tests transpile and execute the actual Home TSX with TypeScript and Node's built-in test runner. Hooks, child components, icons, translations, map loaders, and command boundaries are mocked. Unexpected imports fail closed. Effects are not executed. No browser, server, HTTP client, or robot is contacted, and no additional dependency or shared test configuration is required.

Coverage includes native `disabled` props and direct handler invocation for false/missing Start capability on Gen3 and Gen4, enabled house command arguments, Gen3 spot dimensions/modes, map-to-house fallback, and Gen3 map selection with an enabled map. Direct invocation separately verifies the guard rather than relying on native click suppression. This is offline component characterization, not React lifecycle, browser keyboard, or hardware acceptance.

To run the same tests against an older Home source without changing the checkout:

```sh
git show HEAD:app/src/pages/home/home.tsx > /path/to/control-home.tsx
HOME_START_SOURCE=/path/to/control-home.tsx node --test tests/home-start.cjs
```

Select a pre-fix commit instead of `HEAD` after committing the fix. On upstream `7dbee4c0467873e75484f9ac72bbdf90392ff535`, 10 tests fail and 6 pass; with the fix, all 16 pass. The old-source failures include both native disabled assertions and forbidden command calls. Production Vite bundling passes. Full TypeScript checking still reports 56 existing errors on both upstream and the fixed source; these unrelated errors are not changed here.
