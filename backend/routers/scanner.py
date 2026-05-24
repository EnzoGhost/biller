"""
QR Scanner — standalone in-memory scan sessions for AngelClaims web app.

Flow:
  1. POST /scanner/session   → create session, return token + camera URL
  2. GET  /scanner/poll/{id} → desktop polls for images
  3. POST /scanner/upload/{token} → phone uploads base64 photo
  4. GET  /scanner/camera/{token} → serve camera HTML page to phone

Sessions expire after 5 minutes (TTL).
"""

import asyncio
import base64
import time
import uuid
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scanner", tags=["scanner"])

# ─── In-memory session store ───────────────────────────────────────────────

SESSION_TTL = 300  # 5 minutes

class ScanSession:
    def __init__(self, session_id: str, token: str, purpose: str, app_url: str):
        self.session_id = session_id
        self.token = token
        self.purpose = purpose
        self.created_at = time.time()
        self.images: list[str] = []  # base64 data URLs
        self.camera_url = f"{app_url}/api/scanner/camera/{token}"

    @property
    def is_expired(self) -> bool:
        return time.time() - self.created_at > SESSION_TTL

    @property
    def expires_in(self) -> int:
        remaining = SESSION_TTL - int(time.time() - self.created_at)
        return max(0, remaining)


_sessions: dict[str, ScanSession] = {}  # session_id → session
_token_map: dict[str, str] = {}         # token → session_id


def _cleanup_expired():
    expired = [sid for sid, s in _sessions.items() if s.is_expired]
    for sid in expired:
        s = _sessions.pop(sid)
        _token_map.pop(s.token, None)


# ─── Request / Response models ─────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    purpose: str = "document"  # fee_schedule | inventory | eligibility | document


class CreateSessionResponse(BaseModel):
    session_id: str
    token: str
    url: str
    expires_in: int
    purpose: str


class PollResponse(BaseModel):
    status: str  # waiting | captured | expired
    images: list[str] = []
    image_count: int = 0


class UploadRequest(BaseModel):
    image: str  # base64 data URL or raw base64


# ─── Endpoints ────────────────────────────────────────────────────────────

@router.post("/session", response_model=CreateSessionResponse)
async def create_session(body: CreateSessionRequest, request: Request):
    """Create a scan session and return the camera URL for QR code."""
    _cleanup_expired()

    session_id = str(uuid.uuid4())
    token = str(uuid.uuid4()).replace("-", "")

    # Derive app URL from request
    base = str(request.base_url).rstrip("/")
    # In production, frontend is served separately — use X-Forwarded headers or env
    from config import settings
    app_url = getattr(settings, "APP_URL", base)

    session = ScanSession(session_id=session_id, token=token, purpose=body.purpose, app_url=app_url)
    _sessions[session_id] = session
    _token_map[token] = session_id

    logger.info(f"[scanner] Created session {session_id} purpose={body.purpose}")

    return CreateSessionResponse(
        session_id=session_id,
        token=token,
        url=session.camera_url,
        expires_in=session.expires_in,
        purpose=body.purpose,
    )


@router.get("/poll/{session_id}", response_model=PollResponse)
async def poll_session(session_id: str):
    """Desktop polls this endpoint waiting for phone to upload images."""
    session = _sessions.get(session_id)
    if not session:
        return PollResponse(status="expired")
    if session.is_expired:
        _sessions.pop(session_id, None)
        _token_map.pop(session.token, None)
        return PollResponse(status="expired")

    if session.images:
        return PollResponse(status="captured", images=session.images, image_count=len(session.images))
    return PollResponse(status="waiting", images=[], image_count=0)


@router.post("/upload/{token}")
async def upload_image(token: str, body: UploadRequest):
    """Phone uploads a photo to this endpoint after taking it."""
    session_id = _token_map.get(token)
    if not session_id:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    session = _sessions.get(session_id)
    if not session or session.is_expired:
        raise HTTPException(status_code=410, detail="Session expired")

    # Normalize image to data URL
    img = body.image.strip()
    if not img.startswith("data:"):
        img = f"data:image/jpeg;base64,{img}"

    session.images.append(img)
    logger.info(f"[scanner] Image #{len(session.images)} received for session {session_id}")

    return {"status": "ok", "image_count": len(session.images)}


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Client cleanup."""
    session = _sessions.pop(session_id, None)
    if session:
        _token_map.pop(session.token, None)
    return {"status": "ok"}


@router.get("/camera/{token}", response_class=HTMLResponse)
async def camera_page(token: str):
    """Serve the camera page HTML to the phone."""
    session_id = _token_map.get(token)
    if not session_id:
        return HTMLResponse(content=_expired_html(), status_code=410)

    session = _sessions.get(session_id)
    if not session or session.is_expired:
        return HTMLResponse(content=_expired_html(), status_code=410)

    purpose_labels = {
        "fee_schedule": "Fee Schedule",
        "inventory": "Inventory",
        "eligibility": "Insurance Card",
        "document": "Document",
    }
    purpose_label = purpose_labels.get(session.purpose, "Document")

    return HTMLResponse(content=_camera_html(token, purpose_label))


# ─── Camera page HTML ─────────────────────────────────────────────────────

def _camera_html(token: str, purpose_label: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>AngelClaims — Scan {purpose_label}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #0f172a;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
    }}
    .logo {{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }}
    .logo img {{
      width: 56px;
      height: 56px;
      object-fit: contain;
    }}
    .logo-name {{
      font-size: 18px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: -0.5px;
    }}
    .badge {{
      font-size: 12px;
      background: #1e3a5f;
      color: #7dd3fc;
      padding: 3px 10px;
      border-radius: 999px;
      margin-bottom: 28px;
    }}
    .card {{
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 20px;
      padding: 28px 20px;
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }}
    h1 {{ font-size: 17px; font-weight: 600; color: #f1f5f9; text-align: center; }}
    p.sub {{ font-size: 13px; color: #94a3b8; text-align: center; line-height: 1.5; }}
    #preview {{
      width: 100%;
      border-radius: 12px;
      overflow: hidden;
      display: none;
      position: relative;
    }}
    #preview img {{
      width: 100%;
      display: block;
      border-radius: 12px;
    }}
    .btn {{
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      border: none;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }}
    .btn:active {{ opacity: 0.8; }}
    .btn-primary {{ background: #0ea5e9; color: #fff; }}
    .btn-secondary {{ background: #1e3a5f; color: #7dd3fc; }}
    .btn:disabled {{ background: #334155; color: #64748b; cursor: not-allowed; }}
    .status {{
      font-size: 13px;
      color: #94a3b8;
      text-align: center;
      min-height: 20px;
    }}
    .status.ok {{ color: #34d399; }}
    .status.err {{ color: #f87171; }}
    input[type="file"] {{ display: none; }}
    .icon {{ font-size: 36px; margin-bottom: 4px; }}
    #videoWrap {{
      width: 100%;
      border-radius: 12px;
      overflow: hidden;
      background: #0f172a;
      display: none;
      position: relative;
    }}
    #videoWrap video {{
      width: 100%;
      display: block;
      border-radius: 12px;
    }}
  </style>
</head>
<body>
  <div class="logo">
    <img src="https://app.angelclaims.app/angel-icon.png" alt="AngelClaims" onerror="this.style.display='none'">
    <span class="logo-name">AngelClaims</span>
  </div>
  <div class="badge">{purpose_label}</div>

  <div class="card">
    <div class="icon" id="iconEl">📷</div>
    <h1>Take a Photo</h1>
    <p class="sub" id="subText">Point your camera at the {purpose_label.lower()}.<br>Tap Capture when ready.</p>

    <!-- Live camera preview -->
    <div id="videoWrap">
      <video id="video" autoplay playsinline webkit-playsinline muted></video>
    </div>

    <!-- Static preview after capture -->
    <div id="preview">
      <img id="previewImg" src="" alt="Preview">
    </div>

    <input type="file" id="fileInput" accept="image/*" capture="environment" multiple>
    <button class="btn btn-primary" id="captureBtn">Capture</button>
    <button class="btn btn-secondary" id="sendBtn" style="display:none" onclick="sendPhoto()">Send Photo</button>
    <button class="btn btn-secondary" id="retakeBtn" style="display:none" onclick="retake()">Retake</button>

    <div class="status" id="status"></div>
  </div>

  <canvas id="canvas" style="display:none"></canvas>

  <script>
    const TOKEN = '{token}';
    const API_BASE = window.location.origin + '/api/scanner';
    let stream = null;
    let capturedData = null;

    async function initCamera() {{
      try {{
        stream = await navigator.mediaDevices.getUserMedia({{
          video: {{
            facingMode: {{ exact: 'environment' }},
            width: {{ ideal: 3840, min: 1280 }},
            height: {{ ideal: 2160, min: 720 }},
          }},
          audio: false,
        }}).catch(function() {{
          return navigator.mediaDevices.getUserMedia({{
            video: {{
              facingMode: {{ ideal: 'environment' }},
              width: {{ ideal: 1920, min: 640 }},
              height: {{ ideal: 1080, min: 480 }},
            }},
            audio: false,
          }});
        }});

        const video = document.getElementById('video');
        video.srcObject = stream;
        video.setAttribute('webkit-playsinline', 'true');
        await new Promise(function(resolve) {{
          video.onloadedmetadata = function() {{ video.play().then(resolve).catch(resolve); }};
          if (video.readyState >= 1) video.play().then(resolve).catch(resolve);
        }});

        // Apply advanced constraints for best quality
        var track = stream.getVideoTracks()[0];
        if (track && track.applyConstraints) {{
          try {{
            await track.applyConstraints({{
              advanced: [
                {{ focusMode: 'continuous' }},
                {{ exposureMode: 'continuous' }},
                {{ whiteBalanceMode: 'continuous' }},
              ]
            }});
          }} catch(e) {{ /* Advanced constraints not supported — ignore */ }}
        }}

        document.getElementById('videoWrap').style.display = 'block';
        document.getElementById('iconEl').style.display = 'none';
        document.getElementById('subText').textContent = 'Tap Capture when the {purpose_label.lower()} is in frame.';
        document.getElementById('captureBtn').textContent = 'Capture';
        document.getElementById('captureBtn').onclick = captureFrame;
      }} catch(err) {{
        // getUserMedia failed — fall back to file input
        console.warn('getUserMedia failed, using file input:', err);
        document.getElementById('subText').textContent = 'Tap below to open your camera.';
        document.getElementById('captureBtn').textContent = 'Open Camera';
        document.getElementById('captureBtn').onclick = function() {{
          document.getElementById('fileInput').click();
        }};
      }}
    }}

    function captureFrame() {{
      if (!stream) return;
      var video = document.getElementById('video');
      var canvas = document.getElementById('canvas');
      var track = stream.getVideoTracks()[0];
      var settings = track ? track.getSettings() : {{}};
      canvas.width = settings.width || video.videoWidth;
      canvas.height = settings.height || video.videoHeight;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      capturedData = canvas.toDataURL('image/jpeg', 0.95);

      // Stop stream and show preview
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      document.getElementById('videoWrap').style.display = 'none';
      document.getElementById('previewImg').src = capturedData;
      document.getElementById('preview').style.display = 'block';
      document.getElementById('captureBtn').style.display = 'none';
      document.getElementById('sendBtn').style.display = 'block';
      document.getElementById('retakeBtn').style.display = 'block';
      document.getElementById('status').textContent = 'Photo captured — review and send.';
    }}

    function retake() {{
      capturedData = null;
      document.getElementById('preview').style.display = 'none';
      document.getElementById('sendBtn').style.display = 'none';
      document.getElementById('retakeBtn').style.display = 'none';
      document.getElementById('captureBtn').style.display = 'block';
      document.getElementById('status').textContent = '';
      initCamera();
    }}

    // File input fallback
    document.getElementById('fileInput').addEventListener('change', function(e) {{
      var files = Array.from(e.target.files || []);
      if (!files.length) return;
      var reader = new FileReader();
      reader.onload = function(ev) {{
        capturedData = ev.target.result;
        document.getElementById('previewImg').src = capturedData;
        document.getElementById('preview').style.display = 'block';
        document.getElementById('captureBtn').style.display = 'none';
        document.getElementById('sendBtn').style.display = 'block';
        document.getElementById('retakeBtn').style.display = 'block';
        document.getElementById('status').textContent = 'Photo selected — review and send.';
      }};
      reader.readAsDataURL(files[0]);
    }});

    async function sendPhoto() {{
      if (!capturedData) return;
      var btn = document.getElementById('sendBtn');
      var status = document.getElementById('status');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      status.className = 'status';
      status.textContent = 'Uploading...';
      try {{
        var resp = await fetch(`${{API_BASE}}/upload/${{TOKEN}}`, {{
          method: 'POST',
          headers: {{'Content-Type': 'application/json'}},
          body: JSON.stringify({{ image: capturedData }})
        }});
        if (resp.ok) {{
          status.className = 'status ok';
          status.textContent = 'Photo sent! You can close this page.';
          btn.textContent = 'Sent ✓';
        }} else {{
          throw new Error('Upload failed');
        }}
      }} catch(e) {{
        status.className = 'status err';
        status.textContent = 'Upload failed. Try again.';
        btn.textContent = 'Retry';
        btn.disabled = false;
      }}
    }}

    // Start camera on load
    initCamera();
  </script>
</body>
</html>"""


def _expired_html() -> str:
    return """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AngelClaims — Session Expired</title>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: -apple-system, sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; flex-direction: column; gap: 12px; }
    h1 { font-size: 18px; color: #f87171; }
    p { font-size: 14px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <h1>Session Expired</h1>
  <p>This scan session has expired.<br>Please create a new session on the desktop app.</p>
</body>
</html>"""
