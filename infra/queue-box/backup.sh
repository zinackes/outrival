#!/usr/bin/env bash
set -euo pipefail
# Nightly encrypted dump of the pg-boss queue database to Cloudflare R2.
# Installed at /opt/outrival/backup.sh, run from the deploy user's crontab:
#   17 4 * * * /opt/outrival/backup.sh >> /opt/outrival/backup.log 2>&1
#
# The recipient pubkey is DERIVED from the local private key rather than pasted,
# so rotating the key never leaves the script encrypting to a stale recipient.
#
# ⚠️  The private key /home/deploy/.config/age-outrival.key must ALSO exist off
# this machine. It is the only thing that can read these dumps: lose the box and
# the R2 objects become unreadable noise — the exact scenario the backup exists
# for. Keep a copy in a password manager, not in the same bucket.
STAMP=$(date -u +%Y%m%d-%H%M)
AGE_PUBKEY=$(age-keygen -y /home/deploy/.config/age-outrival.key)
docker exec outrival-pg pg_dump -U outrival -d outrival_queue -Fc \
  | age -r "$AGE_PUBKEY" -o /tmp/queue-$STAMP.dump.age
rclone copy /tmp/queue-$STAMP.dump.age r2:outrival-backups/pg/
rm /tmp/queue-$STAMP.dump.age
rclone delete r2:outrival-backups/pg/ --min-age 30d
