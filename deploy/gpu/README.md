# LangerFace GPU deployment

This service hosts the production web build and exposes same-origin GPU APIs used
by the live wrinkle workflow. The browser handles the UI, MediaPipe landmarks,
optical-flow tracking, temporal stabilization, RSTL geometry, and drawing. The
server keeps the YOLO wrinkle model resident on an NVIDIA GPU and also normalizes
uploaded videos when their original container is unsuitable for browser playback.

This is a direct web application. It does not require Playwright, a remote browser,
a remote desktop stream, Supervisor, Cloudflare, or any AutoDL-specific directory.

## Requirements

- Linux with a compatible NVIDIA GPU and driver
- CUDA 12 and cuDNN 9 libraries supported by the pinned ONNX Runtime package
- Python 3.11+
- Node.js 24.15+ and npm 11+
- FFmpeg and FFprobe on `PATH`

The service intentionally refuses to start when CUDA execution is unavailable. It
never silently falls back to CPU inference.

## Install and build

Run these commands from the repository root:

```bash
cd web
npm ci
VITE_SERVER_COMPUTE=true npm run build
cd ..

python3 -m venv .venv-gpu
. .venv-gpu/bin/activate
python -m pip install --upgrade pip
python -m pip install -r deploy/gpu/requirements.txt
```

The four tracked ONNX model chunks under
`web/compat/personalized/model/` are required. Startup joins them in memory and
checks their SHA-256 against the adjacent metadata before creating the CUDA
session.

## Start

For access only from the same machine:

```bash
. .venv-gpu/bin/activate
python deploy/gpu/service.py
```

Then open <http://127.0.0.1:19420/live>.

To listen on a private network interface or behind an HTTPS reverse proxy:

```bash
LANGERFACE_BIND=0.0.0.0 LANGERFACE_PORT=19420 python deploy/gpu/service.py
```

Do not expose this development server directly to the public internet. Put it
behind an authenticated HTTPS reverse proxy and apply the deployment environment's
firewall and upload-rate limits. The current service has no multi-user account or
job-isolation layer.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LANGERFACE_BIND` | `127.0.0.1` | HTTP bind address |
| `LANGERFACE_PORT` | `19420` | HTTP port |
| `LANGERFACE_NODE` | first `node` on `PATH` | Node 24+ executable used by the image worker |

The frontend and APIs must remain on the same origin. A server-compute build uses
`/api/gpu/*`; a normal `npm run dev` build keeps the browser-local development
path and does not use the CUDA service.

## Health check

After startup:

```bash
curl http://127.0.0.1:19420/api/gpu/health
```

`ready` must be `true`, `yoloProvider` must be `CUDAExecutionProvider`, and
`imageWorkerAlive` must be `true`.

## Runtime behavior

- `POST /api/gpu/yolo/class-masks-rgba` performs the low-latency YOLO correction
  used by live video.
- `POST /api/gpu/media/video` stores and, when needed, converts an uploaded video
  for browser playback. Temporary media is removed when the process exits.
- `POST /api/gpu/wrinkles/image` runs the complete server image-to-lines helper.
- Concurrent YOLO requests are rejected with HTTP 429 instead of accumulating
  stale video frames.

Live video uses first-frame detection, per-frame browser tracking, low-frequency
YOLO correction, confidence gating, temporal smoothing, and batched drawing. This
division keeps UI interaction and rendering responsive while the expensive neural
inference runs on the server GPU.
