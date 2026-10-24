# Local network deployment and storage safety

This change contains robot uploads and map files within their storage directories
and reduces the privileges used by the Docker runtime. Native apps and the web
app keep their existing API and SSE contracts.

See the [Gen3/Gen4 identifier guide](../server/docs/identifiers.md) for example
formats, URL encoding rules, evidence sources, and regression-test expectations.

Robot-provided storage identifiers must be single path components containing
ASCII letters, digits, underscores, hyphens, dots, and colons (maximum 128 characters,
starting with a letter, digit, underscore, or hyphen). Storage rejects symlinks
and replaces output files atomically. Gen3 log uploads are saved as `upload.bin`;
the supplied filename no longer determines the destination. Gen3 map archives
accept flat regular files, including the standard `./` prefix, up to 128 members
and 64 MiB expanded contents. Links, devices, duplicate files, and directory
traversal are rejected before any member is published. These limits do not
provide general traffic or storage quotas.

The Docker entrypoint briefly starts as root to prepare existing data ownership
automatically and then drop privileges with `setpriv`. Database migrations and
the server run as UID/GID **10001:10001**, with only
`CAP_NET_BIND_SERVICE` retained to support legacy low ports with host networking.
The bounding set also discards the startup capabilities. The Compose example
enables no-new-privileges, a read-only image filesystem, a bounded temporary
filesystem, memory/CPU/PID limits, and bounded Docker logs. Adjust resource
limits for your maps/hardware. The application data volume remains writable.
Docker resource limits also require matching host kernel/cgroup support; inspect
`docker info` rather than assuming a requested limit is enforced.

Standard existing Docker/HA volumes are prepared on startup without manual
ownership commands. The walk changes ownership only where required, preserves
data and ordinary modes, does not follow symlinks, and can recover after partial
preparation. Startup CHOWN/DAC_OVERRIDE and identity-switching capabilities are
discarded before application imports; only NET_BIND_SERVICE remains. HA options
are copied privately rather than changing ownership of Supervisor's `/data`.
See [upgrade requirements](upgrades.md) for the contract, unsupported custom
configurations, failure behavior, and schema/rollback considerations. Keep normal
backups and keep the data volume writable; TLS keys remain mode 0600.

The complete image and automatic upgrade behavior have a dedicated container
test suite. See [testing](testing.md) for commands and the distinction between
HA-shaped Docker tests and actual Supervisor/protection-mode/ingress validation.

Host networking is retained for robot discovery and legacy protocol compatibility.

Run the storage tests with Python 3.14 and the server dependencies installed:

```sh
python -m unittest discover -s server/tests -v
```

Tests cover traversal, absolute paths, existing symlinks, atomic replacement,
archive member types/limits, the Gen3 upload-init response, Gen4 map writes, and
HTTP route validation. Gen3 hardware compatibility needs a real robot test;
fixtures alone cannot establish it.

Synthetic Gen3 fixtures also exercise timestamp-shaped IDs such as
`2026-10-20T13:49:10Z`, fractional seconds, and midnight. They use an isolated
HTTP server and SQLite database to cover upload initiation, multipart map/log
uploads, finalization, PNG parsing, persisted history, and map reads with both
literal and URL-encoded colons. Traversal and symlink cases remain rejected.
These generated fixtures are protocol regression tests, not firmware captures.
