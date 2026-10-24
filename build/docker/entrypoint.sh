#!/bin/sh
set -eu

# Preserve legacy low ports even with host networking. Discard root and every
# capability except binding low ports before database migrations/app imports.
# Prepare existing volumes automatically; no operator chown step is required.
if [ "$(id -u)" = 0 ]; then
    prepared_options=$(python /usr/local/lib/vacuula/prepare_data.py)
    if [ -n "$prepared_options" ]; then
        export HA_OPTIONS_PATH="$prepared_options"
    fi
    exec setpriv --reuid=10001 --regid=10001 --clear-groups \
        --inh-caps=+net_bind_service --ambient-caps=+net_bind_service \
        --bounding-set=-all,+net_bind_service --no-new-privs "$@"
fi
exec "$@"
