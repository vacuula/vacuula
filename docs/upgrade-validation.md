# ARM64 snapshot-and-upgrade results

These tests exercise the [deployment procedure](testing.md#snapshot-and-upgrade-procedure)
with synthetic data. Data-preserving upgrades pass in the configurations below;
clean container shutdown and legacy Gen3 endpoint compatibility remain unresolved.
Keep those results separate when assessing readiness.

## Versions and environment

- Candidate source tree: `eb6a3d294d6988b404b46d7cba70aede328e845f`
  (PR branch commit `edf52654804fade8ef9f1b0a8bfad30ecba3b31d`).
- Complete candidate image config digest:
  `sha256:0fd9aa14edb0b473d9e334449de8740a3d8ba80c9eeecdccef7f4842b1eaeb55`.
  Application metadata reports `1.1.0-b6`; Python 3.14.9, ARM64.
- Docker baseline: published 1.0.0 image pinned to
  `ghcr.io/vacuula/vacuula@sha256:577a7d001a935ee7dadae4f85f6e01f1d4d1346dc0c8d8c27bed1f28a3bc5f73`.
- HA: HAOS 18.3 with Core/Supervisor 2026.10.3 in a separate ARM64 KVM VM.
  Stable baseline 1.0.0; beta baseline pinned to published `1.1.0-b6`, rather
  than mutable `beta` (which had advanced to b7 during preparation).
- Standalone: released `v1.0.0` commit
  `bf185858046a4e859489e25cfd28b2848fad38a7`, Debian 13 ARM64 KVM guest,
  Python 3.14.9, Node 22.23.3. Used the documented installer/systemd path;
  this was not an actual LXC container.

No production data was mounted. Two synthetic robots, Gen3 timestamp-shaped and
Gen4 UUID-shaped map/history identifiers, map files, sentinel data and generated
TLS material were checked. Hardware uploads/actions were not part of these runs.
The baseline/candidate checks include SQLite integrity, records, immutable file
and TLS hashes, private key mode 0600, APIs, HTML/JavaScript, runtime identity,
capabilities and repeated startup. Hashes of the database itself are not expected
to remain identical after a schema migration.

## Completed data-upgrade cycles

| Configuration | Result |
| --- | --- |
| Existing standard Compose | Two baseline-to-candidate updates, with stopped-volume snapshot restore and baseline verification between attempts; post-update/restart data checks pass. |
| Candidate hardened Compose | Same two-cycle procedure passes with reduced startup capabilities and read-only root filesystem. |
| HA stable | Two Supervisor updates from 1.0.0, with native partial-backup restore/reverification between attempts; data, private options, configured listeners, privileges and restarts pass. |
| HA beta | Two Supervisor updates from b6, with native partial-backup restore/reverification; the stable checks plus actual HA ingress HTML, referenced JavaScript, server/robot APIs and SSE pass. |
| Standalone systemd | Two normal installer upgrades from restored whole-VM baseline; records/files/TLS, migrations, frontend, configured listeners, dedicated account, capabilities and systemd restrictions pass. Installer backup extraction/integrity and an additional custom environment-file update/restart check pass. |

Docker and HA candidates run as UID/GID 10001, with only NET_BIND_SERVICE in
effective/bounding sets and no-new-privileges enabled. Standalone retains its
native `vacuula` account with the same capability restriction and its systemd
protections. Schema changes from `f09399c9b238` to `5fe01baecb7b` preserve fixture
records; the upstream `installed_with` migration is checked as an expected change.

## Isolation and qualification

Docker tests use isolated named volumes, no external networking, disabled robot
listeners and a fixed host address for the old image's address discovery. They
exercise real Compose updates but do not establish LAN discovery or robot traffic.
Stopped-volume archives preserve ownership/modes; restored SQLite integrity and
records were verified even when the baseline required a forced stop.

HA uses local test copies of the stable/beta manifests, changing image/version
references for pinned baseline and candidate delivery. Supervisor performs the
actual updates and backup restores. A localhost registry runs as a protected,
Supervisor-managed helper; final cycles assert `supported=true`, `healthy=true`,
protected mode, no full host access and no added privileged capabilities. Actual
AppArmor profile is `docker-default`. No checks were disabled. Earlier setup runs
with an unmanaged registry are excluded from the final qualified matrix.

The exact candidate config digest is checked after Supervisor installation.
Docker versions can report an OCI manifest digest instead of its config digest;
both must be resolved before comparing identities. These tests establish the
Supervisor update lifecycle, not official repository release discovery. The HA
Core HTTP port is 8123 so it does not collide with Vacuula's port 80.

Standalone snapshots include a powered-off guest disk and matching UEFI variables.
The normal installer handles ownership and migrations; no repair commands were
added to its update path. Existing environment-file contents and custom API port
were preserved. Original snapshot hashes and final disk integrity were checked.

## Failures and compatibility gaps

- **Container shutdown fails.** The candidate still requires SIGKILL when Docker's
  normal 10-second stop timeout expires (observed 10.28 seconds, exit 137).
  Its PID 1 process has no SIGTERM handler. The baseline also needs a forced
  stop; successful data recovery/restart is not a clean shutdown pass. HA
  Supervisor likewise records exit 137. Signal handling needs a fix and retest.
- **Legacy Gen3 port changes.** Released 1.0.0 listens for Gen3 HTTPS on 443;
  the upstream code included by this candidate defaults to 335 and does not
  keep a second 443 listener. Listener/read tests using each version's configured
  port do not prove an already configured Gen3 robot reconnects automatically.
  This upstream default change needs explicit upgrade handling or a documented
  migration; hardware compatibility is not established by preserved records.
  An isolated control confirms that explicit `GEN3_PORT=443` restores the 443
  listener and HTTPS API access in the candidate; no host robot ports were used.
- The old baseline returns 404 for timestamp map IDs with percent-encoded colons.
  Baseline reads use raw colons; candidate encoded-path reads pass. This is
  recorded as a baseline limitation, not a candidate failure.

## Remaining validation

Actual LXC restrictions, AMD64, real Gen3 hardware, latest-candidate Gen4 actions
and maps, official store release discovery, and interrupted native installer
recovery remain untested. Resource-limit enforcement depends on host kernel
support; this Pi cannot establish enforcement of Docker's memory limit.

The automated checks and report were prepared with AI assistance. Earlier human
Gen4/iOS checks are separate evidence and do not validate this image on hardware.
