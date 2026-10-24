# Updating Vacuula beta

Use Home Assistant's normal app update and backup workflow. Startup prepares the
existing writable application data automatically, then drops privileges before
database migrations and server startup. Standard upgrades do not require manual
ownership changes. Supervisor's options file remains unchanged.

Keep the existing configuration/data mapping. Robot records, maps, history and
TLS certificates are retained. If preparation fails, check the app logs and
report the beta version and error. Do not delete data, disable protection mode,
or enable full host access as a workaround. Backup restoration may discard newer
data, and database schema changes can restrict rollback to older images.

The repository's `docs/testing.md` records the required Supervisor, protection
mode, ingress, and device validation before this change is ready for release.
