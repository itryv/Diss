#!/usr/bin/env bash
#
# Nightly backup of the Diss database (and optionally the recordings).
#
# Run from cron on the host — see "Backups" in README.md. Safe to run at any
# time: it never stops the server and never touches the live database except to
# read it.
#
#   ./backup.sh                 # database only, to ./data/backups
#   BACKUP_RECORDINGS=1 ./backup.sh
#   BACKUP_REMOTE=user@host:/srv/diss-backups ./backup.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${BACKUP_DATA_DIR:-$HERE/data/server}"
OUT_DIR="${BACKUP_OUT_DIR:-$HERE/data/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
SERVICE="${BACKUP_SERVICE:-diss-diss-server-1}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"

mkdir -p "$OUT_DIR"

# `cp` of a live SQLite database in WAL mode produces a file that is missing
# everything still in the -wal, i.e. a silently truncated backup. VACUUM INTO
# takes a consistent snapshot of the whole database while it is in use, which
# is the only correct way to do this online.
#
# better-sqlite3 lives inside the server image, so borrow it rather than adding
# an sqlite3 package to the host.
if ! docker exec "$SERVICE" node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/diss.db', { readonly: true });
  db.prepare(\"VACUUM INTO '/data/backups/diss-$STAMP.db'\").run();
  db.close();
" 2>/dev/null; then
  echo "backup: could not snapshot via $SERVICE — is the container running?" >&2
  exit 1
fi

# The container writes as root into the bind mount; make it readable to the
# operator who will actually have to restore it.
BACKUP_FILE="$OUT_DIR/diss-$STAMP.db"

# A backup nobody has opened is a hypothesis, not a backup. Check it before
# compressing: integrity_check walks the whole b-tree, and counting users and
# meetings catches the "valid empty database" case that a header check misses.
VERIFY="$(docker exec "$SERVICE" node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/backups/diss-$STAMP.db', { readonly: true });
  const ok = db.pragma('integrity_check', { simple: true });
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const meetings = db.prepare('SELECT COUNT(*) c FROM meetings').get().c;
  db.close();
  if (ok !== 'ok') { console.error('integrity_check: ' + ok); process.exit(1); }
  console.log(users + ' users, ' + meetings + ' meetings');
")" || { echo "backup: VERIFICATION FAILED — not keeping $BACKUP_FILE" >&2; sudo rm -f "$BACKUP_FILE"; exit 1; }

sudo chown "$(id -u):$(id -g)" "$BACKUP_FILE" 2>/dev/null || true
gzip -f "$BACKUP_FILE"
BACKUP_FILE="$BACKUP_FILE.gz"

echo "backup: wrote $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1)) — verified: $VERIFY"

if [ "${BACKUP_RECORDINGS:-0}" = "1" ]; then
  REC_OUT="$OUT_DIR/recordings-$STAMP.tar.gz"
  sudo tar -czf "$REC_OUT" -C "$DATA_DIR" recordings
  sudo chown "$(id -u):$(id -g)" "$REC_OUT" 2>/dev/null || true
  echo "backup: wrote $REC_OUT ($(du -h "$REC_OUT" | cut -f1))"
fi

# Offsite. A backup on the same disk as the database survives a bad deploy or a
# stray rm, but NOT the disk or the VPS dying — which is the failure this is
# mostly here for. Set BACKUP_REMOTE to somewhere else entirely.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a --delete-after \
    --include='*.gz' --exclude='*' \
    "$OUT_DIR/" "$BACKUP_REMOTE/"
  echo "backup: mirrored to $BACKUP_REMOTE"
else
  echo "backup: BACKUP_REMOTE not set — this copy is on the same disk as the original." >&2
fi

# Retention.
find "$OUT_DIR" -name 'diss-*.db.gz' -mtime "+$KEEP_DAYS" -delete
find "$OUT_DIR" -name 'recordings-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
echo "backup: done (keeping $KEEP_DAYS days)"
