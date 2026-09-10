"""Exercise the deployed HTTP service against the saved same-frame baseline."""
import argparse
import json
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument('--fixture', required=True)
parser.add_argument('--base', default='http://127.0.0.1:19420')
args = parser.parse_args()
fixture = Path(args.fixture)


def request(path, body=None, content_type='application/octet-stream'):
    req = Request(args.base+path, data=body, headers={'Content-Type': content_type})
    with urlopen(req, timeout=90) as response:
        return response.read()


health = json.loads(request('/api/gpu/health'))
assert health['ready'] and health['yoloProvider'] == 'CUDAExecutionProvider'
assert health['imageWorkerAlive']
assert b'<html' in request('/live')
try:
    request('/api/gpu/yolo/tensor', b'invalid')
    raise AssertionError('Malformed tensor accepted')
except HTTPError as error:
    assert error.code == 400
try:
    request('/api/gpu/wrinkles/image', b'invalid', 'image/png')
    raise AssertionError('Malformed image accepted')
except HTTPError as error:
    assert error.code == 400
expected = json.loads((fixture/'local.json').read_text())
samples = []
for _ in range(4):
    start = time.perf_counter()
    result = json.loads(request('/api/gpu/wrinkles/image', (fixture/'first.png').read_bytes(), 'image/png'))
    elapsed = (time.perf_counter()-start)*1000
    assert result['lines'] == expected['lines'], 'Server line geometry changed'
    assert result['diagnostics'] == expected['diagnostics']
    samples.append({**result['timings'], 'httpMs': elapsed})
report = {
    'health': health,
    'sameFrameLinesExactlyEqual': True,
    'lineCount': len(result['lines']),
    'samples': samples,
    'scope': 'Server loopback HTTP; full image decode/preprocess/CUDA/postprocess/lines; no remote network',
}
(fixture/'service-verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
