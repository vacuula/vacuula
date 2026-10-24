# Gen3 and Gen4 identifiers

Read this before changing identifier validation, URL handling, or storage naming.
The generations use different identifier shapes. A run ID is not necessarily a
UUID, and a robot's displayed label is not necessarily its API identifier.

The examples below are synthetic. The evidence column distinguishes formats
reported or observed on robots from additional regression-test cases. These are
compatibility examples, not a complete firmware specification or an exhaustive
allowlist of identifier formats.

| Identifier | Example shape | Where it is used | Evidence and compatibility rule |
| --- | --- | --- | --- |
| Gen3 run/upload ID | `2026-10-20T13:49:10Z` | Upload-init `group_id`, response `id` and `params.signature`, upload-finish URL, manifest `run.id`, stored map/run ID, and map/history URLs | Timestamp format reported in [PR #48's Gen3 review](https://github.com/vacuula/vacuula/pull/48#discussion_r4334250523). Preserve colons and the original string; do not require a UUID or reformat the timestamp. |
| Gen3 fractional-second run ID | `2026-10-20T13:49:10.123Z` | The same upload and retrieval paths | Additional synthetic regression case. It exercises punctuation compatibility; it is not a claim that every Gen3 firmware emits fractional seconds. |
| Gen3 robot identifier | `00000000-0000-4000-8000-000000000003` | Serial extracted from `Authorization: NEATOBOT <serial>:...`, multipart `key`, manifest `robot_serial`, and API URLs | UUID-shaped synthetic test fixture. Treat robot identifiers as opaque strings; this fixture does not establish an exhaustive Gen3 serial grammar. |
| Gen4 connection/API serial | `0123AB01C12345678` | Login `serial`, connection registry, stored `Robot.serial`, and API URLs | A 17-character alphanumeric serial was observed on the tested Gen4 robot. Do not impose that length on all firmware solely from one device. |
| Gen4 label serial | `0123N101A12345678` | `info.robot` response `body.serial_number`, stored as `label_serial` | A separate field from login `serial`; the handler stores it separately. Use the connection/API serial for API paths. Do not substitute the label or assume they are equal. |
| Gen4 map/run ID | `00000000-0000-4000-8000-000000000004` | `maps.create` body `rank_uuid`, map directory, floor-plan/run records, and retrieval URLs | Stored `rank_uuid` values from the tested Gen4 robot were 36-character UUID strings. This observation does not make UUID validation appropriate for Gen3 IDs or all identifier fields. |
| Server-generated Gen4 request/session ID | `00000000-0000-4000-8000-000000000005` | Outgoing request `id` and login response `session` | The server generates these using `str(uuid.uuid4())`. Their format is independent of robot-provided run IDs. |

## Storage and URL rules

Preserve identifiers exactly across upload initiation, multipart upload,
manifest validation, database persistence, and retrieval. The Gen3 upload-finish
handler compares the manifest's run ID with the URL job ID; rewriting one side
breaks the flow.

For identifiers used as storage components, `storage.component()` accepts
1–128 ASCII characters matching `[A-Za-z0-9_-][A-Za-z0-9_.:-]{0,127}`. This is a
filesystem safety boundary, not a per-generation semantic parser. Preserve both
generations' valid values when changing it. Slash, backslash, percent escapes,
NUL, absolute paths, `.` and `..` are not accepted as literal storage components.
`storage_path()` additionally checks containment and rejects existing symlinks.
Accepting a character in this check does not guarantee that every native host
filesystem supports it; the colon-containing fixtures are tested on Linux.

In URL paths, `2026-10-20T13:49:10Z` and `2026-10-20T13%3A49%3A10Z` refer to
the same identifier. Route matching decodes the URL path exactly once, then
validates its components before dispatch. Decode the path, not a JSON value,
multipart field, or database key. Do not decode repeatedly: `%253A` must not
silently become a colon after two decoding passes. Encoded traversal still
needs to be rejected after decoding.

## Regression coverage and changes

[test_gen3_identifiers.py](../tests/test_gen3_identifiers.py) exercises whole-second,
fractional-second, and midnight timestamps through a local HTTP server, temporary
SQLite database, generated map PNGs, multipart upload, finalization, and history
and map retrieval. It covers literal and encoded colons, traversal attempts,
double encoding, and symlinked upload destinations. These are synthetic protocol
fixtures; they do not replace a physical Gen3 test.

[test_storage_security.py](../tests/test_storage_security.py) covers the shared
storage restrictions, archive handling, and Gen4 map-writing paths. Gen4 fixture
examples are also synthetic; physical Gen4 testing and replay of stored maps
provide separate evidence from those unit tests.

When a new firmware or generation reveals another valid shape:

1. Record the field, generation, example shape, and source of the evidence here.
   Anonymize real robot identifiers before committing examples.
2. Add a regression that fails at the affected protocol boundary, including the
   upload and retrieval flow where relevant, rather than only testing a regex.
3. Preserve tests that reject traversal, symlinks, and repeated URL decoding.
4. State which formats are observed, which are synthetic variants, and whether
   real hardware was tested. Update this guide alongside the tests.

Implementation references: [Gen3 upload flow](../src/vacuula_server/gen3/handlers/beehive.py),
[Gen3 serial extraction](../src/vacuula_server/gen3/utils.py),
[Gen4 handlers](../src/vacuula_server/gen4/handlers.py),
[route matching](../src/vacuula_server/handlers/route_matcher.py), and
[storage helpers](../src/vacuula_server/storage.py).
