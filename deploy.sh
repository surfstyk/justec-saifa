#!/usr/bin/env bash
set -euo pipefail

SERVER="hendrik@46.225.188.5"
REMOTE_DIR="/opt/justec-public"

echo "[deploy] Building..."
npm run build

echo "[deploy] Syncing dist/"
rsync -avz --delete dist/ "$SERVER:$REMOTE_DIR/dist/"

echo "[deploy] Syncing prompts/"
rsync -avz --delete prompts/ "$SERVER:$REMOTE_DIR/prompts/"

echo "[deploy] Syncing config/"
rsync -avz --delete config/ "$SERVER:$REMOTE_DIR/config/"

echo "[deploy] Syncing package files"
scp -q package.json package-lock.json "$SERVER:$REMOTE_DIR/"

echo "[deploy] Installing dependencies"
ssh "$SERVER" "cd $REMOTE_DIR && npm ci --omit=dev --silent"

echo "[deploy] Restarting service"
ssh "$SERVER" "sudo systemctl restart justec-public.service"

echo "[deploy] Verifying..."
sleep 2
HEALTH=$(ssh "$SERVER" "curl -s http://localhost:3100/api/health")
echo "[deploy] Health: $HEALTH"

echo "[deploy] Done."
