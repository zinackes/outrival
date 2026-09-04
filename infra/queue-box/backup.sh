#!/usr/bin/env bash
set -euo pipefail
# Nightly encrypted dumps to Cloudflare R2: the pg-boss queue (local container) and
# the Neon business database. Installed at /opt/outrival/backup.sh, run from the
# deploy user's crontab:
#   17 4 * * * /opt/outrival/backup.sh >> /opt/outrival/backup.log 2>&1
#
# The recipient pubkey is DERIVED from the local private key rather than pasted,
# so rotating the key never leaves the script encrypting to a stale recipient.
#
# ⚠️  The private key /home/deploy/.config/age-outrival.key must ALSO exist off
# this machine. It is the only thing that can read these dumps: lose the box and
# the R2 objects become unreadable noise — the exact scenario the backup exists
# for. Keep a copy in a password manager, not in the same bucket.

# --s3-no-head: rclone follows every PUT with `HEAD <object>?versionId=<id>`, and R2
# has no object versioning, so it answers 501. The PUT itself already returned 200,
# so attempt 1 "failed", attempt 2 found the object already there and the run passed:
# 35 of 35 runs logged an error and still succeeded, which is exactly how a real
# failure would have gone unnoticed. The flag drops that verification call.
# (Audit 2026-09-04, P-08.)
RCLONE=(rclone --s3-no-head)

STAMP=$(date -u +%Y%m%d-%H%M)
AGE_PUBKEY=$(age-keygen -y /home/deploy/.config/age-outrival.key)

ship() {
  local file=$1
  "${RCLONE[@]}" copy "$file" r2:outrival-backups/pg/
  echo "$(date -u +%FT%TZ) uploaded $(basename "$file") ($(du -h "$file" | cut -f1))"
  rm -f "$file"
}

# Queue database (pg-boss), in the local container.
docker exec outrival-pg pg_dump -U outrival -d outrival_queue -Fc \
  | age -r "$AGE_PUBKEY" -o "/tmp/queue-$STAMP.dump.age"
ship "/tmp/queue-$STAMP.dump.age"

# Business database (Neon). Neon's point-in-time restore is provider-locked, so this
# is the only copy that survives losing the Neon account. pg_dump runs inside the
# container because the host has no postgres client; the connection string arrives
# through the container's environment rather than the command line, so it never lands
# in the host's process list. `-pooler.` is stripped because the Neon pooler is
# pgbouncer in transaction mode, which cannot hold pg_dump's snapshot open.
docker exec --env-file /opt/outrival/.env.worker outrival-pg \
  sh -c 'pg_dump "$(printf %s "$DATABASE_URL" | sed "s/-pooler\././")" -Fc --no-owner --no-privileges' \
  | age -r "$AGE_PUBKEY" -o "/tmp/neon-$STAMP.dump.age"
ship "/tmp/neon-$STAMP.dump.age"

"${RCLONE[@]}" delete r2:outrival-backups/pg/ --min-age 30d
