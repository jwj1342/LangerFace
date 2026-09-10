"""Server application and persistent CUDA inference foundation."""
import asyncio
import base64
import hashlib
import io
import json
import mimetypes
import os
import shutil
import struct
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

# The compact mask matrix is small; multithreaded BLAS startup costs more than it saves.
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')

import numpy as np
import onnxruntime as ort
from compact_yolo_postprocess import compact_class_masks
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'web' / 'dist'
MODEL_DIR = ROOT / 'web' / 'compat' / 'personalized' / 'model'
INPUT_BYTES = 1 * 3 * 640 * 640 * 4
RGBA_INPUT_BYTES = 640 * 640 * 4
MEDIA_UPLOAD_BYTES = 512 * 1024 * 1024
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.mkv', '.avi', '.m4v', '.webm'}
DIRECT_VIDEO_CODECS = {'h264', 'vp8', 'vp9', 'av1'}


class CudaDetector:
    def __init__(self):
        metadata = json.loads((MODEL_DIR / 'wrinkle-yolov8s-seg-640.json').read_text())
        model = b''.join((MODEL_DIR / f'wrinkle-yolov8s-seg-640.onnx.part0{i}').read_bytes()
                         for i in range(4))
        self.sha256 = hashlib.sha256(model).hexdigest()
        if self.sha256 != metadata['onnx_sha256'].lower():
            raise RuntimeError('Model checksum mismatch')
        ort.preload_dlls()
        self.session = ort.InferenceSession(model, providers=[
            ('CUDAExecutionProvider', {'use_tf32': '0'}), 'CPUExecutionProvider'])
        if self.session.get_providers()[0] != 'CUDAExecutionProvider':
            raise RuntimeError('CUDA provider unavailable; refusing CPU fallback')
        dummy = np.zeros((1, 3, 640, 640), dtype=np.float32)
        for _ in range(15):
            self.session.run(None, {'images': dummy})
        self.outputs = self.session.get_outputs()

    def infer(self, payload):
        tensor = np.frombuffer(payload, dtype='<f4').reshape(1, 3, 640, 640)
        if not np.isfinite(tensor).all() or tensor.min() < 0 or tensor.max() > 1:
            raise ValueError('Expected finite normalized RGB tensor in [0, 1]')
        start = time.perf_counter()
        outputs = self.session.run(None, {'images': tensor})
        inference_ms = (time.perf_counter() - start) * 1000
        description = json.dumps({'version': 1, 'inferenceMs': inference_ms,
            'modelSha256': self.sha256, 'outputs': [
                {'name': spec.name, 'shape': list(value.shape), 'dtype': 'float32',
                 'bytes': value.nbytes} for spec, value in zip(self.outputs, outputs)
            ]}, separators=(',', ':')).encode()
        return struct.pack('<I', len(description)) + description + b''.join(
            value.astype('<f4', copy=False).tobytes() for value in outputs)

    def infer_class_masks(self, payload):
        tensor = np.frombuffer(payload, dtype='<f4').reshape(1, 3, 640, 640)
        if not np.isfinite(tensor).all() or tensor.min() < 0 or tensor.max() > 1:
            raise ValueError('Expected finite normalized RGB tensor in [0, 1]')
        started = time.perf_counter()
        outputs = self.session.run(None, {'images': tensor})
        inference_ms = (time.perf_counter() - started) * 1000
        postprocess_started = time.perf_counter()
        compact = compact_class_masks(outputs)
        postprocess_ms = (time.perf_counter() - postprocess_started) * 1000
        masks = compact.pop('masks')
        description = json.dumps({
            'version': 1,
            'width': 640,
            'height': 640,
            'classes': ['forehead', 'frown', 'wrinkle'],
            'inferenceMs': inference_ms,
            'postprocessMs': postprocess_ms,
            'modelSha256': self.sha256,
            **compact,
        }, separators=(',', ':')).encode()
        return struct.pack('<I', len(description)) + description + masks.tobytes()

    def infer_class_masks_rgba(self, payload):
        preprocessing_started = time.perf_counter()
        rgba = np.frombuffer(payload, dtype=np.uint8).reshape(640, 640, 4)
        tensor = np.ascontiguousarray(
            rgba[:, :, :3].transpose(2, 0, 1)[None], dtype=np.float32,
        ) / np.float32(255)
        preprocessing_ms = (time.perf_counter() - preprocessing_started) * 1000
        started = time.perf_counter()
        outputs = self.session.run(None, {'images': tensor})
        inference_ms = (time.perf_counter() - started) * 1000
        postprocess_started = time.perf_counter()
        compact = compact_class_masks(outputs)
        postprocess_ms = (time.perf_counter() - postprocess_started) * 1000
        masks = compact.pop('masks')
        description = json.dumps({
            'version': 1,
            'width': 640,
            'height': 640,
            'classes': ['forehead', 'frown', 'wrinkle'],
            'preprocessingMs': preprocessing_ms,
            'inferenceMs': inference_ms,
            'postprocessMs': postprocess_ms,
            'modelSha256': self.sha256,
            **compact,
        }, separators=(',', ':')).encode()
        packed_masks = np.packbits(masks.reshape(-1), bitorder='big')
        description = json.dumps({
            **json.loads(description),
            'maskEncoding': 'bitpack-msb',
            'unpackedMaskBytes': int(masks.size),
        }, separators=(',', ':')).encode()
        return struct.pack('<I', len(description)) + description + packed_masks.tobytes()


@asynccontextmanager
async def lifespan(app):
    app.state.detector = await asyncio.to_thread(CudaDetector)
    app.state.inference_lock = asyncio.Lock()
    app.state.image_lock = asyncio.Lock()
    app.state.media_lock = asyncio.Lock()
    app.state.media_directory = Path(tempfile.mkdtemp(prefix='langerface-media-'))
    app.state.media_files = {}
    node = os.environ.get('LANGERFACE_NODE') or shutil.which('node')
    if not node:
        raise RuntimeError(
            'Node.js was not found. Install Node 24+ or set LANGERFACE_NODE.'
        )
    app.state.image_worker = await asyncio.create_subprocess_exec(
        node, str(ROOT / 'deploy/gpu/wrinkle_worker.mjs'),
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        limit=32*1024*1024)
    try:
        yield
    finally:
        if app.state.image_worker.returncode is None:
            app.state.image_worker.terminate()
            await app.state.image_worker.wait()
        shutil.rmtree(app.state.media_directory, ignore_errors=True)


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.get('/api/gpu/health')
async def health():
    return {'ready': True, 'yoloProvider': app.state.detector.session.get_providers()[0],
            'modelSha256': app.state.detector.sha256, 'ortVersion': ort.__version__,
            'fullServerPipelineReady': False,
            'imageWorkerAlive': app.state.image_worker.returncode is None,
            'pendingServerStages': ['face', 'hands', 'opticalFlow', 'rstl', 'frontendIntegration']}


async def run_media_command(*args, timeout):
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise HTTPException(504, 'Video conversion timed out')
    if process.returncode != 0:
        raise HTTPException(400, stderr.decode('utf-8', errors='replace')[-1000:]
                            or 'Unsupported video')
    return stdout


@app.post('/api/gpu/media/video')
async def prepare_video(request: Request):
    name = request.headers.get('x-langerface-filename', 'upload.mp4')
    suffix = Path(name).suffix.lower()
    if suffix not in VIDEO_EXTENSIONS:
        raise HTTPException(415, 'Unsupported video container')
    token = uuid4().hex
    source = app.state.media_directory / f'{token}{suffix}'
    output = app.state.media_directory / f'{token}-normalized.mp4'
    size = 0
    try:
        with source.open('xb') as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MEDIA_UPLOAD_BYTES:
                    raise HTTPException(413, 'Video upload exceeds 512 MiB')
                stream.write(chunk)
        if size == 0:
            raise HTTPException(400, 'Empty video upload')
        async with app.state.media_lock:
            probe = await run_media_command(
                'ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name', '-of', 'json', str(source), timeout=30)
            try:
                codec = json.loads(probe).get('streams', [{}])[0].get('codec_name')
            except (json.JSONDecodeError, IndexError, AttributeError) as exc:
                raise HTTPException(400, 'Video stream was not found') from exc
            normalized = codec not in DIRECT_VIDEO_CODECS or suffix in {'.mov', '.mkv', '.avi', '.m4v'}
            if normalized:
                await run_media_command(
                    'ffmpeg', '-v', 'error', '-nostdin', '-i', str(source),
                    '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264',
                    '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart', '-c:a', 'aac',
                    str(output), timeout=600)
                source.unlink(missing_ok=True)
                media_path = output
                media_type = 'video/mp4'
            else:
                media_path = source
                media_type = mimetypes.guess_type(source.name)[0] or 'video/mp4'
        app.state.media_files[token] = (media_path, media_type)
        return {
            'url': f'/api/gpu/media/video/{token}',
            'normalized': normalized,
            'sourceCodec': codec,
        }
    except Exception:
        source.unlink(missing_ok=True)
        output.unlink(missing_ok=True)
        raise


@app.get('/api/gpu/media/video/{token}')
async def read_prepared_video(token: str):
    item = app.state.media_files.get(token)
    if not item or not item[0].is_file():
        raise HTTPException(404, 'Prepared video not found')
    return FileResponse(item[0], media_type=item[1], headers={'Cache-Control': 'no-store'})


@app.delete('/api/gpu/media/video/{token}', status_code=204)
async def delete_prepared_video(token: str):
    item = app.state.media_files.pop(token, None)
    if item:
        item[0].unlink(missing_ok=True)
    return Response(status_code=204)


def decode_image(payload):
    with Image.open(io.BytesIO(payload)) as image:
        if image.width * image.height > 2048 * 2048:
            raise ValueError('Image exceeds 4 megapixel processing limit')
        image = ImageOps.exif_transpose(image).convert('RGBA')
        return {'width': image.width, 'height': image.height,
                'rgba': base64.b64encode(image.tobytes()).decode('ascii')}


@app.post('/api/gpu/wrinkles/image')
async def wrinkles(request: Request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 20*1024*1024:
            raise HTTPException(413, 'Image upload exceeds 20 MiB')
    if app.state.image_lock.locked():
        raise HTTPException(429, 'Image processor busy')
    async with app.state.image_lock:
        start = time.perf_counter()
        try:
            decoded = await asyncio.to_thread(decode_image, bytes(data))
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise HTTPException(400, 'Invalid image or unsupported size') from exc
        worker = app.state.image_worker
        if worker.returncode is not None:
            raise HTTPException(503, 'Image processor unavailable')
        worker.stdin.write((json.dumps(decoded)+'\n').encode())
        try:
            await asyncio.wait_for(worker.stdin.drain(), 30)
            response = await asyncio.wait_for(worker.stdout.readline(), 60)
        except (TimeoutError, BrokenPipeError, ConnectionResetError) as exc:
            # A timed-out response must never be consumed by the next request.
            if worker.returncode is None:
                worker.kill()
                await worker.wait()
            raise HTTPException(503, 'Image processor failed') from exc
        if not response:
            raise HTTPException(503, 'Image processor stopped')
        result = json.loads(response)
        if not result.get('ok'):
            raise HTTPException(502, 'Image processing failed')
        result['timings']['serverRequestMs'] = (time.perf_counter()-start)*1000
        return result


@app.post('/api/gpu/yolo/tensor')
async def infer(request: Request):
    if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
        raise HTTPException(415, 'Expected application/octet-stream')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > INPUT_BYTES:
            raise HTTPException(413, 'Input exceeds 640x640 FP32 tensor')
    if len(data) != INPUT_BYTES:
        raise HTTPException(400, 'Incorrect input tensor size')
    # Reject overlapping requests instead of accumulating stale video work.
    if app.state.inference_lock.locked():
        raise HTTPException(429, 'Detector busy; retry after current request')
    async with app.state.inference_lock:
        try:
            result = await asyncio.to_thread(app.state.detector.infer, bytes(data))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return Response(result, media_type='application/octet-stream',
                    headers={'Cache-Control': 'no-store'})


@app.post('/api/gpu/yolo/class-masks')
async def infer_class_masks(request: Request):
    if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
        raise HTTPException(415, 'Expected application/octet-stream')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > INPUT_BYTES:
            raise HTTPException(413, 'Input exceeds 640x640 FP32 tensor')
    if len(data) != INPUT_BYTES:
        raise HTTPException(400, 'Incorrect input tensor size')
    if app.state.inference_lock.locked():
        raise HTTPException(429, 'Detector busy; retry after current request')
    async with app.state.inference_lock:
        try:
            result = await asyncio.to_thread(app.state.detector.infer_class_masks, bytes(data))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    return Response(result, media_type='application/octet-stream',
                    headers={'Cache-Control': 'no-store'})


@app.post('/api/gpu/yolo/class-masks-rgba')
async def infer_class_masks_rgba(request: Request):
    if request.headers.get('content-type', '').split(';')[0] != 'application/octet-stream':
        raise HTTPException(415, 'Expected application/octet-stream')
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > RGBA_INPUT_BYTES:
            raise HTTPException(413, 'Input exceeds 640x640 RGBA frame')
    if len(data) != RGBA_INPUT_BYTES:
        raise HTTPException(400, 'Incorrect RGBA frame size')
    if app.state.inference_lock.locked():
        raise HTTPException(429, 'Detector busy; retry after current request')
    async with app.state.inference_lock:
        result = await asyncio.to_thread(app.state.detector.infer_class_masks_rgba, bytes(data))
    return Response(result, media_type='application/octet-stream',
                    headers={'Cache-Control': 'no-store'})


@app.get('/{path:path}')
async def frontend(path: str):
    if path.startswith('api/'):
        raise HTTPException(404)
    target = (DIST / path).resolve()
    if not target.is_relative_to(DIST.resolve()):
        raise HTTPException(404)
    if target.is_file():
        return FileResponse(target)
    if Path(path).suffix:
        raise HTTPException(404)
    return FileResponse(DIST / 'index.html', headers={'Cache-Control': 'no-cache'})


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host=os.environ.get('LANGERFACE_BIND', '127.0.0.1'),
                port=int(os.environ.get('LANGERFACE_PORT', '19420')))
