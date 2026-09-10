#!/usr/bin/env python3
import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--fixtures', required=True)
parser.add_argument('--base', default='http://127.0.0.1:19420')
parser.add_argument('--output', required=True)
args = parser.parse_args()

fixtures = Path(args.fixtures).resolve()
frames = json.loads((fixtures / 'manifest.json').read_text())['frames']
samples = []
different_pixels = 0
for frame in frames:
    directory = fixtures / frame['id']
    tensor = np.fromfile(directory / 'input.f32', dtype='<f4').reshape(3, 640, 640)
    rgb = np.rint(tensor.transpose(1, 2, 0) * 255).astype(np.uint8)
    if not np.allclose(tensor, rgb.transpose(2, 0, 1).astype(np.float32) / 255, atol=1e-7):
        raise RuntimeError(f"{frame['id']} tensor cannot be represented as RGBA pixels")
    rgba = np.empty((640, 640, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = 255
    started = time.perf_counter()
    request = Request(args.base + '/api/gpu/yolo/class-masks-rgba', data=rgba.tobytes(),
                      headers={'Content-Type': 'application/octet-stream'})
    with urlopen(request, timeout=30) as response:
        body = response.read()
    request_ms = (time.perf_counter() - started) * 1000
    header_size = int.from_bytes(body[:4], 'little')
    metadata = json.loads(body[4:4 + header_size])
    encoded = np.frombuffer(body, dtype=np.uint8, offset=4 + header_size)
    if metadata.get('maskEncoding') == 'bitpack-msb':
        masks = np.unpackbits(encoded, bitorder='big', count=3 * 640 * 640).reshape(3, 640, 640)
    else:
        masks = encoded.reshape(3, 640, 640)
    frame_difference = 0
    for index, name in enumerate(metadata['classes']):
        reference = np.fromfile(directory / f'{name}.mask', dtype=np.uint8).reshape(640, 640)
        frame_difference += int(np.count_nonzero(masks[index] != reference))
    different_pixels += frame_difference
    samples.append({
        'id': frame['id'], 'requestMs': request_ms,
        'preprocessingMs': metadata['preprocessingMs'],
        'inferenceMs': metadata['inferenceMs'],
        'postprocessMs': metadata['postprocessMs'],
        'responseBytes': len(body), 'differentPixels': frame_difference,
    })


def distribution(key):
    values = sorted(sample[key] for sample in samples)

    def at(fraction):
        return values[min(len(values) - 1, int((len(values) - 1) * fraction))]

    return {'median': at(0.5), 'p95': at(0.95), 'min': values[0], 'max': values[-1]}


report = {
    'schemaVersion': 'langerface.compact-yolo-rgba-verification.v1',
    'frameCount': len(samples),
    'differentPixels': different_pixels,
    'pixelExact': different_pixels == 0,
    'timings': {key: distribution(key) for key in (
        'requestMs', 'preprocessingMs', 'inferenceMs', 'postprocessMs')},
    'responseBytes': samples[0]['responseBytes'],
    'samples': samples,
}
Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'samples'}))
