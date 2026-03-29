# GCP Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Vetted Portal v2 to a GCP Compute Engine VM so 5 internal users can access it securely at a static HTTPS URL.

**Architecture:** A single e2-small VM runs the Node.js/Express server behind an Nginx reverse proxy. A 10GB persistent disk at `/data` stores the SQLite database, file uploads, and the `.env` file so all state survives restarts and re-deployments. HTTP Basic Auth at the Nginx layer gates access; self-signed TLS encrypts traffic.

**Tech Stack:** GCP Compute Engine, Debian 12, Node.js 20, Nginx, openssl, systemd, Cloud Storage (backups), gcloud CLI

**Spec:** `docs/superpowers/specs/2026-03-19-gcp-deployment-design.md`

---

## Files Modified

| File | Change |
|---|---|
| `server/index.js` | Read `UPLOAD_DIR` env var instead of hardcoded path (line 38) |
| `server/lib/config.js` | Update default `modelId` from `gemini-2.5-flash` to `gemini-2.0-flash-preview` |

All other steps are infrastructure — no other source files change.

---

## Task 1: Code Change — Make Uploads Directory Configurable

**Files:**
- Modify: `server/index.js:38`
- Modify: `server/lib/config.js:8`

**Why:** Without this, uploaded files go to `/opt/vetted-portal/uploads/` (on the VM's ephemeral boot disk) instead of `/data/uploads/` (on the persistent disk). They would be lost on VM recreation.

- [ ] **Step 1: Edit `server/index.js` line 38**

Change:
```js
const uploadsDir = path.join(__dirname, '../uploads');
```
To:
```js
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
```

- [ ] **Step 2: Verify the change looks correct**

Read the file around lines 37–42 and confirm:
- `uploadsDir` is now set from env var with fallback
- The `fs.existsSync` / `mkdirSync` block immediately below still references `uploadsDir` (it does — no other change needed)

- [ ] **Step 3: Edit `server/lib/config.js` line 8**

Change:
```js
modelId: process.env.MODEL_ID || "gemini-2.5-flash",
```
To:
```js
modelId: process.env.MODEL_ID || "gemini-2.0-flash-preview",
```

- [ ] **Step 4: Verify app still starts locally**

```bash
npm run dev:backend
```
Expected: Server starts on port 3000 with no errors. Check that `uploads/` directory is created at the fallback path (since `UPLOAD_DIR` is not set in local `.env`). Kill with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/lib/config.js
git commit -m "feat: read UPLOAD_DIR env var for configurable uploads path"
```

---

## Task 2: GCP Console — Project and Service Account Setup

All steps in this task are done in the **GCP Console** (console.cloud.google.com) or using `gcloud` CLI on your local machine. The existing `bill-leases` project is used throughout.

- [ ] **Step 1: Confirm active project**

```bash
gcloud config set project bill-leases
gcloud config get-value project
```
Expected: `bill-leases`

- [ ] **Step 2: Create a service account for the VM**

```bash
gcloud iam service-accounts create vetted-portal-sa \
  --display-name="Vetted Portal VM Service Account"
```

- [ ] **Step 3: Grant required IAM roles**

```bash
# Vertex AI
gcloud projects add-iam-policy-binding bill-leases \
  --member="serviceAccount:vetted-portal-sa@bill-leases.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Firestore
gcloud projects add-iam-policy-binding bill-leases \
  --member="serviceAccount:vetted-portal-sa@bill-leases.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Cloud Storage (for nightly backups)
gcloud projects add-iam-policy-binding bill-leases \
  --member="serviceAccount:vetted-portal-sa@bill-leases.iam.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

- [ ] **Step 4: Reserve a static external IP**

```bash
gcloud compute addresses create vetted-portal-ip \
  --region=us-central1
```

Note the IP address assigned:
```bash
gcloud compute addresses describe vetted-portal-ip --region=us-central1 --format="get(address)"
```
Write it down — you'll need it when creating the VM.

- [ ] **Step 5: Create the Cloud Storage backup bucket**

```bash
gsutil mb -p bill-leases -l us-central1 gs://vetted-portal-backups
```

- [ ] **Step 6: Set 30-day lifecycle rule on backup bucket**

Create a local file `lifecycle.json`:
```json
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
```

Apply it:
```bash
gsutil lifecycle set lifecycle.json gs://vetted-portal-backups
rm lifecycle.json
```

---

## Task 3: GCP Console — Create the VM

All steps in GCP Console or `gcloud` CLI.

- [ ] **Step 1: Create the VM with persistent disk**

```bash
gcloud compute instances create vetted-portal \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-project=debian-cloud \
  --image-family=debian-12 \
  --boot-disk-size=20GB \
  --boot-disk-type=pd-balanced \
  --create-disk=name=vetted-data,size=10,type=pd-ssd,auto-delete=no \
  --address=vetted-portal-ip \
  --service-account=vetted-portal-sa@bill-leases.iam.gserviceaccount.com \
  --scopes=cloud-platform \
  --tags=vetted-portal
```

`--scopes=cloud-platform` enables ADC for all GCP services on this VM.
`auto-delete=no` on the data disk ensures it survives VM deletion.

- [ ] **Step 2: Create firewall rules**

```bash
# Allow HTTPS
gcloud compute firewall-rules create allow-vetted-https \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:443 \
  --target-tags=vetted-portal

# Allow HTTP (redirects to HTTPS via Nginx)
gcloud compute firewall-rules create allow-vetted-http \
  --direction=INGRESS \
  --action=ALLOW \
  --rules=tcp:80 \
  --target-tags=vetted-portal
```

- [ ] **Step 3: Verify port 3000 is NOT externally accessible**

```bash
gcloud compute firewall-rules list --filter="allowed~tcp:3000"
```
Expected: no rules listed. If any appear, delete them.

- [ ] **Step 4: SSH into the VM**

```bash
gcloud compute ssh vetted-portal --zone=us-central1-a
```

All remaining tasks run inside this SSH session unless noted otherwise.

---

## Task 4: VM — Mount Persistent Disk and Create Users

Run all commands as the default `sudo`-capable user (not `vetted`).

- [ ] **Step 1: Format the persistent disk (first time only)**

```bash
sudo mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0 /dev/sdb
```

Expected: Filesystem creation message. `/dev/sdb` is the data disk — verify with `lsblk` first if unsure.

- [ ] **Step 2: Mount the disk at `/data`**

```bash
sudo mkdir -p /data
sudo mount /dev/sdb /data
```

- [ ] **Step 3: Add to `/etc/fstab` so it mounts on reboot**

```bash
echo UUID=$(sudo blkid -s UUID -o value /dev/sdb) /data ext4 discard,defaults,nofail 0 2 | sudo tee -a /etc/fstab
```

- [ ] **Step 4: Create `vetted` OS user**

```bash
sudo useradd --system --shell /bin/bash --create-home vetted
```

- [ ] **Step 5: Create directory structure on persistent disk**

```bash
sudo mkdir -p /data/uploads
sudo chown -R vetted:vetted /data
```

---

## Task 5: VM — Install Software

- [ ] **Step 1: Update package list and install dependencies**

```bash
sudo apt-get update
sudo apt-get install -y nginx git apache2-utils curl apt-transport-https ca-certificates gnupg
```

`apache2-utils` provides the `htpasswd` command for Basic Auth.

- [ ] **Step 2: Install Node.js 20 via NodeSource**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

- [ ] **Step 3: Install Google Cloud CLI system-wide (required for backup cron)**

Installing via apt puts `gsutil` at a system path accessible to all users, including the `vetted` cron user. The curl-based installer only installs to the current user's home directory.

```bash
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
sudo apt-get update && sudo apt-get install -y google-cloud-cli
```

- [ ] **Step 4: Verify versions**

```bash
node --version   # Expected: v20.x.x
npm --version    # Expected: 10.x.x
nginx -v         # Expected: nginx/1.x.x
git --version    # Expected: git version 2.x.x
gsutil version   # Expected: gsutil version x.x.x
```

---

## Task 6: VM — Deploy the App

- [ ] **Step 1: Set up GitHub credentials on the VM**

If the repo is **public**, skip this step.

If the repo is **private**, set up a GitHub Personal Access Token (PAT) before cloning:

```bash
# Store credentials so git pull works non-interactively
git config --global credential.helper store
echo "https://<your-github-username>:<your-PAT>@github.com" > ~/.git-credentials
chmod 600 ~/.git-credentials
```

Generate a PAT at GitHub → Settings → Developer settings → Personal access tokens. Grant `repo` (read) scope only.

- [ ] **Step 2: Clone the repository**

```bash
sudo git clone https://github.com/YOUR_ORG/vetted_portal_v2.git /opt/vetted-portal
```

Replace `YOUR_ORG/vetted_portal_v2` with the actual GitHub repo path.

- [ ] **Step 3: Create the `.env` file on the persistent disk**

```bash
sudo nano /data/.env
```

Paste the following, filling in actual values:
```
DEMO_MODE=true
DATABASE_PATH=/data/vetted_portal.db
UPLOAD_DIR=/data/uploads
PORT=3000
GCP_PROJECT=bill-leases
GCP_LOCATION=us-central1
MODEL_ID=gemini-2.0-flash-preview
FIRESTORE_LEASES_COLLECTION=leases
FIRESTORE_PROPERTIES_COLLECTION=properties
```

Save with Ctrl+X, Y, Enter.

- [ ] **Step 4: Symlink `.env` into the app directory**

```bash
sudo ln -s /data/.env /opt/vetted-portal/.env
```

- [ ] **Step 5: Set ownership on app directory**

```bash
sudo chown -R vetted:vetted /opt/vetted-portal
```

- [ ] **Step 6: Install dependencies and build**

```bash
sudo -u vetted bash -c "cd /opt/vetted-portal && npm install && npm run build"
```

Expected: No errors. `dist/` directory created inside `/opt/vetted-portal`.

---

## Task 7: VM — TLS Certificate

- [ ] **Step 1: Create directory for the cert**

```bash
sudo mkdir -p /etc/ssl/vetted
```

- [ ] **Step 2: Generate self-signed certificate (valid 5 years)**

```bash
sudo openssl req -x509 -nodes -days 1825 -newkey rsa:2048 \
  -keyout /etc/ssl/vetted/key.pem \
  -out /etc/ssl/vetted/cert.pem \
  -subj "/C=US/ST=State/L=City/O=Vetted/CN=vetted-portal"
```

Expected: Two files created — `key.pem` and `cert.pem`.

- [ ] **Step 3: Restrict permissions on private key**

```bash
sudo chmod 600 /etc/ssl/vetted/key.pem
sudo chmod 644 /etc/ssl/vetted/cert.pem
```

---

## Task 8: VM — Configure Nginx

- [ ] **Step 1: Create Basic Auth password file**

```bash
sudo htpasswd -c /etc/nginx/.htpasswd vetted
```

You'll be prompted to set a password. Choose something to share with the 5 users. Store it somewhere secure (e.g., 1Password).

- [ ] **Step 2: Write Nginx site config**

```bash
sudo nano /etc/nginx/sites-available/vetted-portal
```

Paste exactly:
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

    # SSE routes — disable buffering, extend timeouts for lease bot streaming
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

- [ ] **Step 3: Enable the site and disable the default**

```bash
sudo ln -s /etc/nginx/sites-available/vetted-portal /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
```

- [ ] **Step 4: Test Nginx config**

```bash
sudo nginx -t
```

Expected: `syntax is ok` and `test is successful`. If not, re-check the config for typos.

- [ ] **Step 5: Start and enable Nginx**

```bash
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

## Task 9: VM — systemd Service

- [ ] **Step 1: Write the service file**

```bash
sudo nano /etc/systemd/system/vetted-portal.service
```

Paste exactly:
```ini
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

- [ ] **Step 2: Reload systemd, enable and start the service**

```bash
sudo systemctl daemon-reload
sudo systemctl enable vetted-portal
sudo systemctl start vetted-portal
```

- [ ] **Step 3: Verify service is running**

```bash
sudo systemctl status vetted-portal
```

Expected: `Active: active (running)`. If it shows `failed`, check logs:
```bash
sudo journalctl -u vetted-portal -n 50
```

Common issues:
- `.env` symlink not found → check `ls -la /opt/vetted-portal/.env`
- Node not found at `/usr/bin/node` → check with `which node`
- Port 3000 already in use → check `sudo ss -tlnp | grep 3000`

---

## Task 10: VM — Backup Cron Job

`gsutil` was installed system-wide in Task 5 Step 3 via `google-cloud-cli`. No additional installation needed here.

- [ ] **Step 1: Create the cron job**

```bash
sudo nano /etc/cron.d/vetted-backup
```

Paste exactly (note the escaped `%` — required in cron):
```
0 2 * * * vetted gsutil cp /data/vetted_portal.db gs://vetted-portal-backups/$(date +\%Y-\%m-\%d).db
```

- [ ] **Step 2: Verify the cron file permissions**

```bash
sudo chmod 644 /etc/cron.d/vetted-backup
```

- [ ] **Step 3: Test the backup command manually as `vetted` user**

```bash
sudo -u vetted gsutil cp /data/vetted_portal.db gs://vetted-portal-backups/test-manual.db
```

Expected: File uploaded without error. Verify:
```bash
gsutil ls gs://vetted-portal-backups/
```
Expected: `gs://vetted-portal-backups/test-manual.db` listed.

---

## Task 11: Smoke Test

- [ ] **Step 1: Get the static IP**

```bash
# Run from your local machine
gcloud compute addresses describe vetted-portal-ip --region=us-central1 --format="get(address)"
```

- [ ] **Step 2: Test HTTP → HTTPS redirect**

```bash
curl -I http://<STATIC_IP>/
```

Expected: `301 Moved Permanently` with `Location: https://...`

- [ ] **Step 3: Test HTTPS with Basic Auth**

```bash
curl -k -u vetted:<your-password> https://<STATIC_IP>/api/admin/health
```

The `-k` flag accepts the self-signed cert. Expected: `{"status":"ok"}` or similar JSON response from the server.

- [ ] **Step 4: Open in browser**

Navigate to `https://<STATIC_IP>`. Accept the security warning. Enter the Basic Auth credentials. Expected: Vetted Portal login page loads.

- [ ] **Step 5: Log in and do a quick functional check**

- Log in as `admin@vetted.com`
- Confirm the sidebar loads with projects/chats
- Navigate to `/lease-chat` and confirm the page loads

- [ ] **Step 6: Verify SSE streaming works (lease bot)**

The lease bot is the most fragile component — it requires buffering to be disabled in Nginx and long timeouts. Test it explicitly:

1. On the `/lease-chat` page, upload any small PDF
2. Watch the ingestion log panel — you should see progress lines streaming in **as they arrive** (not all at once after a delay)
3. If lines appear only at the end after a long pause, Nginx is still buffering — re-check the `/api/leases/` location block in `/etc/nginx/sites-available/vetted-portal`

---

## Ongoing Deploy Procedure

For every code update after the initial setup, SSH into the VM and run:

```bash
gcloud compute ssh vetted-portal --zone=us-central1-a

cd /opt/vetted-portal
sudo -u vetted git pull
sudo -u vetted npm install
sudo -u vetted npm run build
sudo systemctl restart vetted-portal

# Verify it came back up
sudo systemctl status vetted-portal
```

~5 seconds of downtime. The persistent disk is untouched by this procedure.
