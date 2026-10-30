# Home command-error regression coverage

From `app`, after installing the locked dependencies:

```sh
node --test tests/home-command-errors.cjs
pnpm exec vite build
pnpm exec tsc -b --pretty false
```

The tests transpile and execute the production Home component, command functions, and Http client with the installed TypeScript compiler and Node's test runner. They use real Axios response interceptors and status validation, replacing only the HTTP adapter with offline responses. Hooks, map loaders, child components, translations, and timers are deterministic seams. Unexpected imports fail closed, and effects are not executed. This is offline component/HTTP-client characterization, not browser lifecycle or robot acceptance.

Coverage includes Gen3 and Gen4 Start, Stop, Pause, Resume, Locate, and Base, plus Gen3 robot-alert dismissal. Rejected responses include Gen3 HTTP 400 with a non-`ok` robot result, Gen4 HTTP 409, server disconnected responses, HTTP 504, network failure, and client timeout. Successful controls remain silent. Tests also cover spot/map/zone Start branches, accessible local error dismissal without I/O, retained errors after later success, failed Locate animation cleanup, and pause-delay-Base ordering, including rejection at either command.

The server already converts non-`ok` Gen3 results to HTTP 400 (`gen3/event_handler.py`), forwards Gen4 response codes (`gen4/handlers.py`), and returns HTTP 504 when the robot does not answer (`handlers/app.py`). Axios rejects these statuses, so Home needs to catch the command promise rather than add a second result parser. HTTP 400 can also mean the robot is disconnected. Transport loss does not prove that the robot never acted, so the same deliberately cautious localized message covers all failures, with no automatic retry or raw server error display.

To run the same suite against the original Home source:

```sh
git show 7dbee4c0467873e75484f9ac72bbdf90392ff535:app/src/pages/home/home.tsx > /path/to/home-original.tsx
HOME_COMMAND_SOURCE=/path/to/home-original.tsx node --test tests/home-command-errors.cjs
```

On that original source, 101 tests fail and 16 pass, with missing feedback and unhandled command rejections. On the fixed source, all 117 pass. Production Vite bundling passes with its existing large-chunk warning. Full TypeScript checking still fails: 55 existing diagnostics remain, versus 56 on the original tree. The removed diagnostic was the untyped robot-alert result access replaced by awaiting the existing HTTP success contract; normalized diagnostics show no additions.

The candidate composes with PR #83 in both application orders with byte-identical Home source. All 117 command-error tests and PR #83's 16 Start tests pass against that combined component. The existing 3.5-second pause-to-Base delay is preserved, not qualified as a readiness signal. No dock-memory changes, server deployment, network device access, or hardware tests are included.
