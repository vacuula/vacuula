# Testing storage, upgrades, and Home Assistant

## Server tests

With Python 3.14 and server dependencies installed:

```sh
python -m unittest discover -s server/tests -v
```

The Gen3 tests use generated PNGs, timestamp-shaped identifiers, a local HTTP
server, and a temporary SQLite database. They cover upload initiation, multipart
map/log upload, finalization, persistence and retrieval, including encoded colons
and traversal rejection. They are not hardware captures. The shared storage
tests additionally cover Gen4 writes, symlinks, atomic replacement and archive
limits. See [identifier evidence](../server/docs/identifiers.md).

## Complete image and upgrade tests

Build from the repository root, rather than overlaying source onto an installed
image. This validates dependency installation, frontend compilation, build
context/COPY rules, and the actual entrypoint:

```sh
docker build -t vacuula:test -f build/docker/Dockerfile .
VACUULA_TEST_IMAGE=vacuula:test python3 -m unittest discover -s tests/container -v
```

If your host requires sudo for Docker, set
`VACUULA_TEST_DOCKER='sudo -n docker'` for the test command. Tests create unique
disposable named volumes/containers, use no host networking, and never mount the
production volume. A legacy fixture creates an older Alembic schema, a robot
record, maps, and a certificate/private key with root-owned mode 0700/0600 data.
It is representative upgrade data, not a fixture copied from a user's backup.

The suite checks fresh startup, unattended ownership/schema upgrade, repeated
startup, partial preparation recovery, preservation of certificates/data,
post-start UID/capabilities, read-only-image operation, symlink handling, and
controlled failure for read-only volumes, missing privileges and hardlinks.

## Snapshot-and-upgrade procedure

Run this procedure independently for Docker/Compose, Home Assistant stable,
Home Assistant beta, and LXC/standalone systemd. Use isolated environments and
representative fixtures; do not attach production robot data or share a writable
data volume with the live server.

1. **Establish the baseline.** Install the previous supported release through
   that deployment's documented procedure. Pin and record its release, commit
   and image digest where applicable. Create representative robot records,
   Gen3 timestamp-shaped and Gen4 UUID-shaped map IDs, map/history records,
   configuration and TLS material. Label synthetic data explicitly; see the
   [identifier guide](../server/docs/identifiers.md).
2. **Test before upgrading.** Record startup/migration logs, API responses,
   frontend and map/history reads, configured ports/options, ownership and
   private key modes, schema revision, and hashes of immutable fixture files.
   Record effective user/capabilities and shutdown behavior. Record baseline
   failures rather than treating them as candidate regressions or passing tests.
3. **Take a consistent snapshot.** Stop the application cleanly and verify no
   writer remains. Snapshot the environment and persistent data together,
   including deployment definitions, options, database, maps and TLS files.
   Preserve owners, modes and links. Do not copy a live SQLite database as the
   only backup. If shutdown needs a forced kill, record it and verify database
   integrity before accepting the baseline snapshot.
4. **Apply the candidate normally.** Start from that saved baseline and apply
   the exact PR image/commit through the deployment's normal update mechanism.
   Keep existing data attached. Do not pre-chown data, edit stored records, run
   extra migrations, disable protection mode or otherwise repair the fixture.
   An upgrade that needs such a repair fails this check. Normal installer
   prompts, such as choosing whether to take a backup, are not repair steps.
5. **Test after upgrading.** Repeat the baseline checks and compare expected
   records and immutable file hashes. Confirm the schema reaches the candidate
   revision, data and the TLS identity survive, private file modes remain
   appropriate, and migrations/application run with the intended privileges.
   Check the full frontend, map/history APIs and logs, not just container state.
6. **Restart and recover.** Stop/start the candidate again, repeat readiness and
   preservation checks, and verify shutdown behavior. Exercise interrupted
   ownership preparation/recovery in a disposable copy where supported. Record
   any new startup work and confirm it is safe to repeat.
7. **Restore and repeat.** Stop the candidate and restore the complete baseline
   snapshot, including its matching application version/configuration. Verify
   the original behavior/data, then repeat the candidate upgrade to establish
   reproducibility. Restore a second isolated copy when testing backup restore.
   Do not equate running an old binary against an upgraded database with a
   supported rollback; see [upgrade and rollback requirements](upgrades.md).

Use these deployment-specific mechanisms and checks:

| Deployment | Snapshot and normal update path | Additional checks |
| --- | --- | --- |
| Docker/Compose | Stop the container; save its data volume and Compose/environment configuration with the pinned baseline image. Replace the image using Compose. | Upgrade using the existing standard Compose definition as well as the candidate example; verify data preparation, low ports, read-only root and capability drop. |
| HA stable | Take an HA backup and a powered-off HAOS VM snapshot (guest disk plus UEFI variables), or equivalent consistent devcontainer state. Apply the update through Supervisor. | Protected mode, private options, actual data mounts, AppArmor, Supervisor logs, backup/restore and direct web access. |
| HA beta | Use a separate baseline fixture/snapshot and the beta add-on definition; apply the update through Supervisor. | The HA stable checks plus ingress and its frontend assets/API routing. |
| LXC/standalone systemd | Stop the service; snapshot the container/VM filesystem and service/configuration/data. Check out the candidate and rerun the documented installer. | Installer migrations and ownership handling, the dedicated `vacuula` account, systemd restrictions/capabilities, low ports, service restart and existing data retention. The Docker entrypoint is not used here. |

For HA, make the candidate available under a test version/image reference while
preserving the add-on's runtime settings. Confirm Supervisor actually installs
that candidate digest; replacing a container by hand does not test its update
lifecycle. Keep stable and beta tests separate so listener ports and data do not
collide. Ensure HA Core's HTTP port does not conflict with Vacuula's configured
port, and record any baseline port configuration.

### Coverage status

The ARM64 snapshot runs are recorded in [the validation report](upgrade-validation.md).
A data-preserving update pass is separate from clean shutdown and physical robot
compatibility; the report records failures and remaining gaps.

| Coverage | Evidence/status |
| --- | --- |
| Automated Docker upgrade regressions | 9 tests passed against the full ARM64 candidate image, using synthetic legacy-schema/root-owned fixtures. |
| Previous-release Docker/Compose snapshot cycle | Data preservation, restore/repeat and restarts passed twice with the existing Compose configuration and twice with the candidate configuration. Candidate clean shutdown fails. |
| HA stable and beta | Each passed two Supervisor update/native-backup-restore cycles while supported and healthy; data, options, privileges and restarts checked. Beta ingress HTML/assets/APIs/SSE passed. Local test mirrors validate Supervisor lifecycle, not official release discovery. Candidate clean shutdown fails. |
| Standalone systemd | Two Debian 13 VM snapshot/upgrade cycles, restarts, installer backups and custom environment preservation passed. Actual LXC restrictions remain untested. |
| Physical robots | Earlier Gen4/iOS checks used an earlier candidate. Latest-candidate Gen4 checks and real Gen3 hardware validation remain outstanding. The old Gen3 default port is not preserved automatically. |

Report architecture separately: ARM64 results do not establish AMD64 behavior.
Synthetic Gen3/Gen4 identifiers exercise protocol/storage handling, but this
matrix does not replace physical device tests.

## Home Assistant coverage

The Docker suite includes `/server/data` and a separate read-only `/data` mount
with root-private `options.json`. It verifies configured API-port selection,
private temporary options and unchanged Supervisor-owned options. This simulates
the add-on's filesystem/options contract only. It does not run Supervisor or HA.

For full testing, follow Home Assistant's [app testing guide](https://contributors.home-assistant.io/apps/guides/testing/)
using its Supervisor development container or a disposable Home Assistant OS
installation. Test the actual stable and beta add-on definitions, including
protection mode and beta ingress, with the candidate image available to the
Supervisor. Merely installing Home Assistant Core in Docker is not this test.

Before taking this PR out of draft, record results for:

- Installing the previous add-on image, creating root-owned data, then upgrading
  through Supervisor with no terminal/chown/config repair commands.
- Robot/map/history retention, the same TLS certificate, and successful restart.
- Fresh install and a second upgrade/restart; interruption/recovery if feasible.
- Options, ingress for the beta add-on, Supervisor logs, and backup/restore.
- Actual Gen3 uploads/retrieval and a Gen4 action/run/map cycle. State clearly
  which hardware was available and which tests remain synthetic.

Use a disposable HA environment for this matrix. Supervisor may pull a published
image when `image:` is present; make sure it is testing the candidate you built,
not an unrelated registry tag. See [HA's configuration reference](https://contributors.home-assistant.io/apps/reference/configuration/).

## Reporting results

Give exact commands, commit/image digest, architecture, runtime, and results in
the PR description. Separate automated tests, full-image builds, filesystem-only
HA simulations, Supervisor tests, and physical device tests. Do not convert a
successful manually repaired installation into evidence of an unattended upgrade.
