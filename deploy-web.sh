#!/usr/bin/env bash
# SometeoPR Web App — Deploy to VPS
set -euo pipefail

VPS="wink@159.65.235.231"
VPS_DIR="/opt/someteopr/app"

cd "$(dirname "$0")"
echo "🚀 SometeoPR Web Deploy"

# 1. Build frontend
echo "📦 Building frontend..."
cd frontend && npm run build 2>&1 | tail -3 && cd ..
echo "✅ Frontend built"

# 2. Sync backend
echo "📤 Syncing backend..."
rsync -avz --delete \
  --exclude='.venv' --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.env' --exclude='*.db' --exclude='*.db.bak' \
  -e ssh backend/ "$VPS:$VPS_DIR/backend/"

# 3. Sync built frontend  
echo "📤 Syncing frontend dist..."
rsync -avz --delete -e ssh frontend/dist/ "$VPS:$VPS_DIR/static/"

# 4. Sync Docker/deploy files
scp Dockerfile.web docker-compose.web.yml "$VPS:$VPS_DIR/"

# 5. Copy static files into backend dir (FastAPI serves them)
ssh "$VPS" "cp -r /opt/someteopr/app/static /opt/someteopr/app/backend/static"

# 6. Fix permissions
ssh "$VPS" "chmod -R a+r /opt/someteopr/app/ && find /opt/someteopr/app -type d -exec chmod 755 {} +"

# 6. Build and start container
echo "🐳 Building container..."
ssh "$VPS" "cd $VPS_DIR && sudo docker compose -f docker-compose.web.yml up -d --build 2>&1 | tail -10"

# 7. Health check
sleep 5
STATUS=$(ssh "$VPS" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8100/health 2>/dev/null || echo 000")
if [ "$STATUS" = "200" ]; then
  echo "✅ SometeoPR web app live on port 8100"
else
  echo "⚠️ Health check returned $STATUS"
  ssh "$VPS" "sudo docker compose -f $VPS_DIR/docker-compose.web.yml logs --tail 20"
fi
