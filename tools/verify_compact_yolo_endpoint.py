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
    payload = (directory / 'input.f32').read_bytes()
    started = time.perf_counter()
    request = Request(args.base + '/api/gpu/yolo/class-masks', data=payload,
                      headers={'Content-Type': 'application/octet-stream'})
    with urlopen(request, timeout=30) as response:
        body = response.read()
    request_ms = (time.perf_counter() - started) * 1000
    header_size = int.from_bytes(body[:4], 'little')
    metadata = json.loads(body[4:4 + header_size])
    masks = np.frombuffer(body, dtype=np.uint8, offset=4 + header_size).reshape(3, 640, 640)
    frame_difference = 0
    for index, name in enumerate(metadata['classes']):
        reference = np.fromfile(directory / f'{name}.mask', dtype=np.uint8).reshape(640, 640)
        frame_difference += int(np.count_nonzero(masks[index] != reference))
    different_pixels += frame_difference
    samples.append({'id': frame['id'], 'requestMs': request_ms,
                    'inferenceMs': metadata['inferenceMs'],
                    'postprocessMs': metadata['postprocessMs'],
                    'responseBytes': len(body), 'differentPixels': frame_difference})


def distribution(key):
    values = sorted(sample[key] for sample in samples)

    def at(fraction):
        return values[min(len(values) - 1, int((len(values) - 1) * fraction))]

    return {'median': at(0.5), 'p95': at(0.95), 'min': values[0], 'max': values[-1]}


report = {
    'schemaVersion': 'langerface.compact-yolo-endpoint-verification.v1',
    'frameCount': len(samples),
    'differentPixels': different_pixels,
    'pixelExact': different_pixels == 0,
    'timings': {key: distribution(key) for key in ('requestMs', 'inferenceMs', 'postprocessMs')},
    'responseBytes': samples[0]['responseBytes'],
    'samples': samples,
}
Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'samples'}))
