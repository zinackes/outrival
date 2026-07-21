#!/usr/bin/env bash
# One-shot health snapshot of the queue box. Read-only.
cd /opt/outrival
echo "=== CONTENEURS ==="; docker compose ps
echo "=== RAM ==="; free -h | head -2
echo "=== DISQUE ==="; df -h / | tail -1
echo "=== CHARGE ==="; uptime
echo "=== TUNNEL ==="; sudo wg show 2>/dev/null | grep -E "peer|handshake|transfer" || echo "(wg0 down)"
echo "=== JOBS PAR ETAT ==="
docker exec outrival-pg psql -U outrival -d outrival_queue -c \
  "SELECT name, state, count(*) FROM pgboss.job GROUP BY 1,2 ORDER BY 1,2;" 2>/dev/null \
  || echo "(schema pgboss absent - normal tant que le worker n'a jamais demarre)"
echo "=== CRONS ENREGISTRES (attendu: 17) ==="
docker exec outrival-pg psql -U outrival -d outrival_queue -At -c \
  "SELECT count(*) FROM pgboss.schedule;" 2>/dev/null
echo "=== DEAD LETTER (attendu: 0) ==="
docker exec outrival-pg psql -U outrival -d outrival_queue -At -c \
  "SELECT count(*) FROM pgboss.job WHERE name = 'outrival-dlq';" 2>/dev/null
echo "=== DERNIER BACKUP R2 ==="; rclone lsl r2:outrival-backups/pg/ 2>/dev/null | sort -k2,3 | tail -1
