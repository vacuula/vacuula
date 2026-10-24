# frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend

WORKDIR /app

RUN corepack enable

COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm approve-builds @parcel/watcher
RUN pnpm install --frozen-lockfile

COPY app/ ./

RUN pnpm vite build


FROM python:3.14-slim AS python-build

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /uvx /bin/

WORKDIR /server

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-editable --no-install-project

COPY server/src ./src

RUN version="$(sed -nE 's/^version = "(.*)"/\1/p' pyproject.toml | head -1)" \
    && printf 'APP_VERSION = "%s"\n' "${version:-0.0.0-dev}" > src/vacuula_server/_build_version.py

RUN uv sync --frozen --no-dev --no-editable


# final server image
FROM python:3.14-slim

WORKDIR /server

# tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl openssl util-linux \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 vacuula \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin vacuula \
    && mkdir -p /server/data \
    && chown 10001:10001 /server/data

ENV PATH="/server/.venv/bin:$PATH" PYTHONUNBUFFERED=1

COPY --from=python-build /server/.venv ./.venv

COPY server/ssl/vacuula.cnf ./ssl/vacuula.cnf
COPY server/alembic.ini ./
COPY server/migrations ./migrations

# Built frontend
COPY --from=frontend /app/dist ./web

COPY --chmod=755 build/docker/entrypoint.sh /usr/local/bin/vacuula-entrypoint
COPY build/docker/prepare_data.py /usr/local/lib/vacuula/prepare_data.py
ENTRYPOINT ["vacuula-entrypoint"]

CMD ["sh", "-c", "alembic upgrade head && exec vacuula-server"]
