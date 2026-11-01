#!/usr/bin/env bash
# Sauvegarde quotidienne PostgreSQL + fichiers, rétention 30 jours.  Cron : 0 2 * * * /chemin/scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL requis}"
DIR="${BACKUP_DIR:-./backups}"; mkdir -p "$DIR"
STAMP=$(date +%F)
pg_dump "$DATABASE_URL" -Fc -f "$DIR/ecole-$STAMP.dump"
[ -d "${UPLOAD_DIR:-backend/uploads}" ] && tar -czf "$DIR/uploads-$STAMP.tgz" -C "$(dirname "${UPLOAD_DIR:-backend/uploads}")" "$(basename "${UPLOAD_DIR:-backend/uploads}")"
find "$DIR" -type f \( -name 'ecole-*.dump' -o -name 'uploads-*.tgz' \) -mtime +30 -delete
echo "Sauvegarde terminée : $DIR (rétention 30 jours)"
