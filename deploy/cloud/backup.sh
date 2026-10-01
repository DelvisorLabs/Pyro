#!/usr/bin/env bash
set -euo pipefail
: "${AGE_RECIPIENT:?Set your age public recipient key; keep the private key offline}"
: "${BACKUP_DIRECTORY:?Set the local encrypted backup directory}"
mkdir -p "$BACKUP_DIRECTORY"
chmod 700 "$BACKUP_DIRECTORY"
umask 077
archive="$BACKUP_DIRECTORY/pyro-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
trap 'rm -f "$archive.partial"' EXIT
docker compose --env-file "${CLOUD_ENV_FILE:-.env.cloud}" -f docker-compose.cloud.yml exec -T postgres pg_dump -U pyro_migrator -d pyro --format=custom --no-owner \
  | age --recipient "$AGE_RECIPIENT" --output "$archive.partial"
mv "$archive.partial" "$archive"
printf 'Encrypted backup: %s\n' "$archive"
# Copy to a separate host/object store and apply the documented retention policy.
