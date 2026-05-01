#!/usr/bin/env bash
# SometeoPR Web App — Deploy to VPS
# Usage: ./deploy-web.sh
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────
VPS_USER="wink"
VPS_HOST="159.65.235.231"
VPS_DIR="/opt/someteopr/app"
REMOTE="${VPS_USER}@${VPS_HOST}"
HEALTH_URL="http://localhost:8100/health"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 SometeoPR Web Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Build frontend locally ───────────────────────────────────
echo "📦 Building frontend..."
cd frontend
npm ci --silent
npm run build
cd "$SCRIPT_DIR"
echo "✅ Frontend built"

# ── Step 2: Ensure remote directories exist ──────────────────────────
echo "📂 Preparing remote directories..."
ssh "$REMOTE" "sudo mkdir -p ${VPS_DIR} /opt/someteopr/data && sudo chown -R ${VPS_USER}:${VPS_USER} /opt/someteopr"

# ── Step 3: Rsync code to VPS ────────────────────────────────────────
echo "📤 Syncing files to VPS..."
# Sync backend code
rsync -avz --delete \
    --chmod=D755,F644 \
    --exclude='.venv' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.env' \
    --exclude='biller.db' \
    --exclude='biller.db.bak' \
    backend/ \
    "$REMOTE:${VPS_DIR}/backend/"

# Sync frontend source (for Docker build)
rsync -avz --delete \
    --chmod=D755,F644 \
    --exclude='node_modules' \
    frontend/ \
    "$REMOTE:${VPS_DIR}/frontend/"

# Sync Docker files
rsync -avz --chmod=D755,F644 \
    Dockerfile.web \
    docker-compose.web.yml \
    "$REMOTE:${VPS_DIR}/"

echo "✅ Files synced"

# ── Step 4: Copy env if not present ──────────────────────────────────
ssh "$REMOTE" "test -f /opt/someteopr/.env || echo '# Copy env.web.example and fill in values' > /opt/someteopr/.env"

# ── Step 5: Build and deploy with Docker Compose ─────────────────────
echo "🐳 Building and starting containers..."
ssh "$REMOTE" "cd ${VPS_DIR} && docker compose -f docker-compose.web.yml up -d --build"
echo "✅ Container started"

# ── Step 6: Health check ─────────────────────────────────────────────
echo "🏥 Waiting for health check..."
sleep 5

for i in $(seq 1 6); do
    if ssh "$REMOTE" "curl -sf ${HEALTH_URL}" > /dev/null 2>&1; then
        echo "✅ Health check passed!"
        ssh "$REMOTE" "curl -s ${HEALTH_URL}" | python3 -m json.tool 2>/dev/null || true
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "🎉 SometeoPR deployed successfully!"
        echo "   Internal: http://${VPS_HOST}:8100"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        exit 0
    fi
    echo "   Attempt $i/6 — waiting..."
    sleep 5
done

echo "❌ Health check failed after 30s"
echo "   Check logs: ssh ${REMOTE} 'cd ${VPS_DIR} && docker compose -f docker-compose.web.yml logs'"
exit 1
