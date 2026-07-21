# Queue box — `outrival-queue-01`

Netcup RS 1000 G12 · `152.53.113.71` · Ubuntu 24.04 · user `deploy` (sudo NOPASSWD).

Runs the pg-boss queue Postgres and the two worker processes. The API and web
live on a **separate** OVH VPS (`151.80.58.65`, Coolify) and reach this box only
through a WireGuard tunnel.

These files mirror what is deployed under `/opt/outrival` and `/etc`. They are
copies for disaster recovery, not a deployment mechanism — nothing here is
applied automatically. Edit a file on the box, mirror it here in the same commit.

```
                  WireGuard 10.10.0.0/24
  OVH app VPS  ──────────────────────────────►  queue box
  10.10.0.2                                     10.10.0.1
  api (Coolify)                                 outrival-pg      :5432 (wg only)
  web (Coolify)                                 worker-light     cron + AI + alerts
                                                worker-browser   scrapes + PDF
```

## Layout

| File | Deployed to |
|---|---|
| `docker-compose.yml` | `/opt/outrival/docker-compose.yml` |
| `docker-compose.override.yml` | `/opt/outrival/docker-compose.override.yml` |
| `backup.sh` | `/opt/outrival/backup.sh` (0755, deploy) |
| `check.sh` | `/opt/outrival/check.sh` (0755, deploy) |
| `env.worker.example` | `/opt/outrival/.env.worker` (0600, **never committed**) |
| `wg0.conf.example` | `/etc/wireguard/wg0.conf` on **both** boxes |
| `docker-wait-for-wg.conf` | `/etc/systemd/system/docker.service.d/` |

## Secrets — never in this repo

| Secret | Lives at | Off-box copy |
|---|---|---|
| Queue Postgres password | `.env.worker` + Coolify `QUEUE_DATABASE_URL` + the `outrival` role | password manager |
| WireGuard private keys | `/etc/wireguard/{queue,ovh}.key` (0600) | regenerable — see below |
| **age backup key** | `/home/deploy/.config/age-outrival.key` | **REQUIRED — see warning** |

> ⚠️ **The age key is the single point of failure.** `backup.sh` encrypts every
> dump to it. If this box is lost and the key was only ever here, every object in
> `r2:outrival-backups/pg/` is permanently unreadable. Keep a copy in a password
> manager. It is 184 bytes.

WireGuard keys are the exception: losing them costs one regeneration + config
swap on both ends, no data.

## Rebuild from scratch

Order matters — each step's verification must pass before the next.

### 1. OS baseline

```bash
hostnamectl set-hostname outrival-queue-01
timedatectl set-timezone UTC
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.d/99-outrival.conf
```

### 2. SSH hardening + firewall

`/etc/ssh/sshd_config`: `PermitRootLogin no`, `PasswordAuthentication no`,
`MaxAuthTries 3`, `AllowUsers deploy`.

```bash
ufw default deny incoming && ufw default allow outgoing
ufw limit 22/tcp comment 'SSH rate-limited'
ufw enable
apt install -y fail2ban unattended-upgrades
```

Verify: `sshd -T | grep -E 'permitrootlogin|passwordauthentication|maxauthtries|allowusers'`
→ `no` / `no` / `3` / `deploy`.

> `ufw limit` bans a source IP after 6 connections in 30s. Scripted SSH loops
> from one host will lock themselves out — reuse one connection
> (`ssh -o ControlMaster=auto -o ControlPath=/tmp/cm -o ControlPersist=10m`).

### 3. Docker

`/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
```

`usermod -aG docker deploy`. No container may publish a port to `0.0.0.0`.

### 4. WireGuard — before Postgres

Follow `wg0.conf.example` on both boxes, then on this one:

```bash
ufw allow from 151.80.58.65 to any port 51820 proto udp comment 'wireguard from ovh app vps'
systemctl enable --now wg-quick@wg0
cp docker-wait-for-wg.conf /etc/systemd/system/docker.service.d/ && systemctl daemon-reload
```

Verify from the OVH box: `ping -c3 10.10.0.1` and `wg show` (recent handshake,
non-zero transfer both ways).

### 5. Postgres + workers

```bash
mkdir -p /opt/outrival && cd /opt/outrival
# copy docker-compose.yml, docker-compose.override.yml, backup.sh, check.sh
printf 'POSTGRES_PASSWORD=%s\n' "$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)" > .env
chmod 600 .env
# create .env.worker from env.worker.example, same password in QUEUE_DATABASE_URL
docker compose up -d
```

`boss.start()` creates the `pgboss` schema on first boot; the light worker then
registers the 17 cron schedules. Verify with `./check.sh`: containers healthy,
17 schedules, 0 dead-letter.

### 6. Backups

Install `age`, `age-keygen`, `rclone`. Configure the `r2` remote. **Restore the
age key from your password manager** (a new key cannot read old dumps). Then:

```bash
crontab -l | grep backup || (crontab -l 2>/dev/null; echo '17 4 * * * /opt/outrival/backup.sh >> /opt/outrival/backup.log 2>&1') | crontab -
```

### 7. Heartbeat

Create a Better Stack / UptimeRobot **heartbeat** (period 5 min, grace 15 min) —
not a monitor: the box calls out, nothing calls in. Put the URL in
`HEARTBEAT_URL`. Without it there is no dead-man switch at all.

## Restore a dump

```bash
rclone copy r2:outrival-backups/pg/queue-YYYYMMDD-HHMM.dump.age /tmp/
age -d -i /home/deploy/.config/age-outrival.key -o /tmp/queue.dump /tmp/queue-*.dump.age
docker exec -i outrival-pg pg_restore -U outrival -d outrival_queue --clean --if-exists < /tmp/queue.dump
```

In-flight jobs are disposable: crons re-fire and parents re-enqueue. A restore is
for schema/schedule recovery, not for replaying lost work.

## Operating notes

- **Exactly one worker owns cron.** `ownsScheduling = role === "light"` drives
  `schedule`, `supervise` and `syncSchedules()`. Two `light` workers double-fire
  every schedule; zero means no cron runs at all and nothing says so.
- **`docker compose up -d` may not recreate a container** after an `env_file`
  edit. Use `--force-recreate`, then confirm with
  `docker ps --format '{{.Names}} | created={{.CreatedAt}}'`.
- **Rotating the queue password** touches three places — the `outrival` role,
  `.env.worker`, and Coolify's `QUEUE_DATABASE_URL`. Do it in ONE shell (the
  generated value must survive across the steps) and force-recreate the workers.
  Symptom of a partial rotation: `28P01 password authentication failed` in
  `docker logs outrival-pg`.
- `docker exec outrival-pg psql -U outrival` needs no password: `pg_hba.conf`
  trusts the container-local socket. Handy when the credential is in doubt.
- **Trigger.dev is the rollback** until the wrappers under
  `apps/workers/src/jobs/*.job.ts` are deleted. Its schedules are disabled, not
  removed. Re-enabling them while a `light` worker runs double-fires everything.

## History

- **2026-07-21** — pg-boss cutover. WireGuard tunnel, Postgres rebound to
  `10.10.0.1`, queue password rotated, `HEARTBEAT_URL` set, Trigger.dev schedules
  disabled, `worker-light` flipped to `WORKER_ROLE=light`. 17 crons registered;
  API → pg-boss → worker → `classify-change` verified end to end.
