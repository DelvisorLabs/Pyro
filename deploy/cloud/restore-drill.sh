#!/usr/bin/env bash
set -euo pipefail
: "${AGE_IDENTITY:?Set the path to an age identity file}"
: "${BACKUP_FILE:?Set an encrypted backup file}"
# Always restore to a new database; never drop or overwrite a running installation.
restore_db="pyro_restore_$(date -u +%Y%m%dT%H%M%S)"
compose=(docker compose --env-file "${CLOUD_ENV_FILE:-.env.cloud}" -f "${CLOUD_COMPOSE_FILE:-docker-compose.cloud.yml}")
"${compose[@]}" exec -T postgres createdb -U pyro_migrator "$restore_db"
age --decrypt --identity "$AGE_IDENTITY" "$BACKUP_FILE" \
  | "${compose[@]}" exec -T postgres pg_restore -U pyro_migrator --dbname "$restore_db" --exit-on-error --no-owner
"${compose[@]}" exec -T postgres psql -U pyro_migrator -d "$restore_db" --set=ON_ERROR_STOP=1 -c 'SELECT org_id, count(*) FROM pyro_documents GROUP BY org_id; SELECT version FROM pyro_schema_migrations ORDER BY version;'
printf 'Restored into isolated database %s. Test cloud startup with the matching encryption secret before cutover.\n' "$restore_db"
