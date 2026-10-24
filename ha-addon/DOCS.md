# Updating Vacuula

Use Home Assistant's normal app update and backup workflow. Vacuula's startup
prepares the existing application data automatically before running database
migrations and starting the server as a dedicated user. Standard upgrades do not
require terminal commands or manual file ownership changes.

Keep the app's existing configuration/data mapping. TLS certificates, robot
records, maps, and history are retained. Options are read through a private
temporary copy; Supervisor's own options file is not modified.

If startup preparation fails, check the app logs. Do not delete the data, disable
protection mode, or enable full host access as a workaround. Report the app
version and error message. Database schema changes can limit rollback; restoring
a backup can discard data collected after the backup.

Contributor validation requirements and current platform-test limitations are in
the repository's `docs/testing.md` and `docs/upgrades.md`.
