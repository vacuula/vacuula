# Upgrade requirements and behavior

## Contract for contributors

Standard Docker, Home Assistant add-on, and LXC/standalone installations must
upgrade successfully with their existing writable data, without manual ownership
commands or other repair steps. This includes unattended image updates where
supported. The standalone procedure still requires rerunning its installer; it
does not fetch and apply releases automatically. This is a requirement for changes
to startup, permissions, or data storage, not a claim that every release has been
validated on every platform.

Keep the existing robot records, maps, TLS key/certificate, configuration, and
history. Test an old root-owned volume with private files, a fresh volume, a
repeat startup, and recovery after partial preparation. Verify that migration
cannot follow an uploaded symlink outside the data tree. Any schema migration
also needs data-preservation and rollback analysis.

Run one writer per data volume. Use an update mechanism that stops the old
server before starting its replacement; overlapping old/new instances sharing
SQLite and the same files are not a supported rolling-upgrade arrangement.

Image delivery and data migration are different operations. Docker's `latest`
tag and `restart: unless-stopped` do not fetch new images by themselves. A user,
Home Assistant Supervisor, or an update service supplies the new image; the
image's startup must then prepare existing data automatically.

The [snapshot-and-upgrade procedure](testing.md#snapshot-and-upgrade-procedure)
checks each deployment before and after its normal update, then restores the
baseline and repeats the upgrade. Docker/HA use the image entrypoint; standalone
uses its installer and systemd service. Passing one does not establish the others.

## What this change does

On normal root-started container boot:

1. Prepare `/server/data` for UID/GID 10001. Walk directories using file
   descriptors, refuse cross-filesystem traversal and unsupported special files,
   and never follow symlinks. Refuse ownership changes to multiply-linked files.
2. Change only entries whose owner/group differs. Keep file contents and normal
   permission modes, including mode 0600 TLS keys. Repeating the walk repairs a
   partially prepared volume and does not require a completion marker.
3. If Home Assistant options exist, copy their JSON into a private temporary
   directory readable by the application. Do not chown Supervisor's `/data` or
   its options file. Environment variables retain their normal precedence.
4. Drop to UID/GID 10001, keep only NET_BIND_SERVICE in the effective and bounding
   capability sets, and enable no-new-privileges. Then run the existing Alembic
   migrations and replace the startup shell with the server process.

The preparation code does not import the application or open its database. It
rescans ownership on each startup so interrupted preparation can recover. The
cost scales with the number of data entries. Persistent symlinks are not
migrated; application storage checks reject them when used as destinations.

The standard Compose configuration grants CHOWN and DAC_OVERRIDE for preparation,
plus SETUID/SETGID/SETPCAP for dropping privileges and NET_BIND_SERVICE for legacy
ports. All except NET_BIND_SERVICE are discarded before migrations/application
imports. The previous standard Compose file uses Docker's default capabilities,
which also provide the startup capabilities; normal existing deployments do not
need to replace their Compose file merely to repair ownership.

## Operators

Use your normal image/add-on update mechanism and its backup facilities. Keep
the existing data volume attached and writable. No manual `chown` step is needed
for the standard container deployment. The image does not enable automatic
updates, install an updater, or change your update preferences.

Custom `user:` settings, dropped startup capabilities, read-only data mounts,
root-squashed network filesystems, and nested mounts are outside the standard
automatic-migration setup. A custom non-root process needs a data volume it can
already access. If preparation cannot complete, startup exits with an actionable
error before launching the server; it does not silently fall back to running the
application as root or broaden filesystem permissions. Do not disable protection
mode or add full host access to work around an HA failure; capture the logs and
report the unsupported setup.

Ownership changes alone do not make the volume unreadable by the former
root-running image. However, database schema changes may make an older image
incompatible. Check the migration revisions before rollback; a backup restore
can discard data accumulated after that backup. Keep normal backups and do not
remove the data volume when replacing a container.

## Evidence and release gate

See [the testing matrix](testing.md). Plain Docker can exercise HA-shaped options
and mounts, but it cannot establish Supervisor permissions, AppArmor behavior,
ingress integration, backup/restore, or actual Supervisor update success. Keep
the PR in draft until required Supervisor and device checks are complete.
