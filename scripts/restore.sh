#!/usr/bin/env bash
# Restauration : ./scripts/restore.sh backups/ecole-2026-10-29.dump   (écrase le contenu de la base !)
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL requis}"
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" "$1"
echo "Base restaurée depuis $1"
