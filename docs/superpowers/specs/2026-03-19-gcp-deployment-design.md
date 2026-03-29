# GCP Deployment Design — Vetted Portal v2

**Date:** 2026-03-19
**Status:** Approved
**Audience:** Small internal team (~5 users)

## Overview

Deploy the Vetted Portal v2 full-stack app (React + Node.js/Express + SQLite) to GCP using a Compute Engine VM with a persistent disk. Requires one small code change to make uploads persistent.

## Infrastructure

### GCP Services (all in existing `bill-leases` project)

| Service | Purpose | Est. Cost/mo |
|---|---|---|
| Compute Engine e2-small VM | Runs the Node.js app | ~$14 |
| Persistent Disk (10 GB SSD) | Stores SQLite DB + uploaded files | ~$2 |
| Static External IP | Stable address for the app | ~$3 |
| VPC Firewall Rules | Restricts inbound traffic | free |
| Cloud Storage bucket (`vetted-portal-backups`) | Nightly SQLite DB backups | ~$1 |
| **Total** | | **~$20–35/mo** |

### VM Software Stack

- **OS:** Debian 12 (latest GCP default)
- **Node.js:** v20 LTS
- **Nginx:** Reverse proxy, HTTPS termination, HTTP Basic Auth
- **systemd:** Process manager — keeps app running, auto-restarts on crash
- **openssl:** Self-signed TLS certificate (browsers will show a warning; users click through once)

### Persistent Disk Mount

The persistent disk is mounted at `/data` on the VM:

```
/data/vetted_portal.db     ← SQLite database
/data/uploads/             ← Multer file uploads
/data/.env                 ← Environment file (symlinked into app dir)
```

This means all stateful data survives VM restarts and re-deployments. The `.env` lives here too so it is not lost if the app directory is recreated during a deploy.

## Required Code Change

`server/index.js` currently hardcodes the uploads directory as a relative path:

```js
// current — NOT persistent in the cloud
const uploadsDir = path.join(__dirname, '../uploads');
```

This must be changed to read the `UPLOAD_DIR` environment variable:

```js
// required change
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
```

This is the only code change required. Everything else is infrastructure configuration.

## Security

### Layers

1. **HTTPS (self-signed cert)** — all traffic encrypted in transit; users accept the browser warning once
2. **Nginx HTTP Basic Auth** — one shared username/password gate before the app loads; prevents public access
3. **VPC Firewall** — only ports 80 and 443 open to the internet; port 3000 must NOT have an external firewall rule (verified during setup); SSH locked to deployer's IP or via GCP IAP (browser-based, no exposed port)
4. **Non-root app user** — Node.js runs as a dedicated `vetted` OS user with no sudo privileges
5. **TLS hardening** — Nginx configured to TLS 1.2/1.3 only, no deprecated protocols
6. **Nightly DB backups** — cron job copies SQLite file to Cloud Storage; 30-day retention

### What is NOT included (acceptable for internal tool)

- No Web Application Firewall (Cloud Armor) — overkill for 5 users
- No per-user passwords beyond Basic Auth — email-only auth is sufficient behind the shared gate
- No DDoS protection beyond GCP's built-in network protection

## Deployment Workflow

### First-Time Setup (~1 hour, one-time)

1. Create VM with persistent disk in GCP Console; attach service account with required IAM roles (see below)
2. Reserve and attach static external IP
3. Install Node.js 20, Nginx, git on the VM
4. Mount persistent disk at `/data`; create `uploads/` subdirectory
5. **Create `vetted` OS user** (must happen before app setup)
6. Create `.env` at `/data/.env` (copied/typed manually — never committed to git)
7. Set ownership: `chown -R vetted:vetted /data`
8. Clone repo to `/opt/vetted-portal`; symlink `.env`: `ln -s /data/.env /opt/vetted-portal/.env`
9. Set ownership: `chown -R vetted:vetted /opt/vetted-portal`
10. Run `npm install && npm run build` (as `vetted` user)
11. Generate self-signed TLS certificate with `openssl`
12. Configure Nginx (see config below)
13. Create `htpasswd` file for Basic Auth: `htpasswd -c /etc/nginx/.htpasswd vetted`
14. Create and enable systemd service `vetted-portal` (runs as `vetted` user)
15. Create Cloud Storage bucket: `gsutil mb gs://vetted-portal-backups`
16. Set lifecycle rule: delete objects older than 30 days
17. Set up nightly backup cron job (see below)
18. **Verify** port 3000 has no external VPC firewall rule

### Service Account IAM Roles

The VM's service account must have:

| Role | Purpose |
|---|---|
| `roles/aiplatform.user` | Vertex AI (Gemini) |
| `roles/datastore.user` | Firestore |
| `roles/storage.objectCreator` | Write nightly backups to GCS |

### Ongoing Deploys (manual, ~5 minutes)

```bash
# SSH into VM (via GCP Console browser or gcloud)
cd /opt/vetted-portal
git pull
npm install
npm run build
sudo systemctl restart vetted-portal
```

~5 seconds of downtime per deploy. Acceptable for an internal tool.

### Environment Variables

Stored at `/data/.env` on the persistent disk. Set once during initial setup.

```
DEMO_MODE=true
DATABASE_PATH=/data/vetted_portal.db
UPLOAD_DIR=/data/uploads
PORT=3000
GCP_PROJECT=bill-leases
GCP_LOCATION=us-central1
MODEL_ID=gemini-2.0-flash-preview
# Note: server/lib/config.js defaults to gemini-2.5-flash if this var is unset.
# The implementation plan includes updating that default to match.
FIRESTORE_LEASES_COLLECTION=leases
FIRESTORE_PROPERTIES_COLLECTION=properties
```

Note: `SEED_DEMO_DATA` is not included — seeding is triggered automatically when the users table is empty (i.e., on first run with a fresh database). No env var needed.

### GCP Credentials (Vertex AI + Firestore)

Application Default Credentials (ADC) are provided automatically by the VM's service account via the metadata server. No key files needed.

## Nginx Configuration

```nginx
server {
    listen 80;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;

    ssl_certificate     /etc/ssl/vetted/cert.pem;
    ssl_certificate_key /etc/ssl/vetted/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    auth_basic "Vetted Portal";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # SSE routes — disable buffering and extend timeouts
    # Used by lease ingestion (/api/leases/ingest) and lease chat (/api/leases/chat)
    location /api/leases/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # All other routes
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## systemd Service

```ini
# /etc/systemd/system/vetted-portal.service
[Unit]
Description=Vetted Portal v2
After=network.target

[Service]
Type=simple
User=vetted
WorkingDirectory=/opt/vetted-portal
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/data/.env

[Install]
WantedBy=multi-user.target
```

## Backup Strategy

```bash
# /etc/cron.d/vetted-backup — runs nightly at 2am as vetted user
0 2 * * * vetted gsutil cp /data/vetted_portal.db gs://vetted-portal-backups/$(date +\%Y-\%m-\%d).db
```

Cloud Storage lifecycle rule: delete objects older than 30 days. The `vetted` user's ADC credentials come from the VM's service account via the metadata server — no additional auth setup required, as long as `roles/storage.objectCreator` is included on the service account.

## Out of Scope

- Custom domain / Let's Encrypt (can add later by installing Certbot and updating Nginx)
- CI/CD pipeline (can add GitHub Actions later)
- Staging environment
- Horizontal scaling / load balancing
- Cloud SQL migration
