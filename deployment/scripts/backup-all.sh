#!/usr/bin/env bash
# Backup penuh cluster (pg_dumpall). Cron: 0 2 * * * /path/backup-all.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/storage/backups/full_$(date +%Y%m%d_%H%M%S).sql.gz"
umask 077
pg_dumpall -h 127.0.0.1 -p "${PGPORT:-5433}" -U "${PGUSER:?set PGUSER}" | gzip > "$OUT"
find "$ROOT/storage/backups" -name 'full_*.sql.gz' -mtime +14 -delete
echo "$OUT"
